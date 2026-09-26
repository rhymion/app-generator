'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { cache } from 'react';
import { TtlLruCache } from '@/lib/_ttl_lru';
import { SELF_ONLY_ADMIN_BYPASS_ENTITIES } from '@/lib/self_only_admin_bypass_entities';
import { AppError } from '@/lib/_errors';
import { enterRequestScope, memoizeInRequestScope } from '@/lib/_request_scope';

export const getSessionUserId = cache(async function getSessionUserId(): Promise<string | null> {
  enterRequestScope();
  const session = await auth();
  return session?.user?.id ?? null;
});

export async function getSessionUserIdOrThrow(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new AppError('SESSION_EXPIRED', 'User not authenticated');
  }
  return userId;
}

export type Operation = 'create' | 'read' | 'update' | 'delete' | 'import';
export type ModelName = string;
export type OperationFlags = Record<Operation, boolean>;

/** The public permissions type: just the four effective boolean flags. Used by all components. */
export type ModelPermissions = OperationFlags;

/**
 * Rich permissions carrying sub-objects for deferred item-level resolution.
 * Returned by getModelPermissions and resolvePermissions.
 * Stripped to ModelPermissions via toPermissions() before passing to components.
 *
 *   general  — from global permissions + user's non-special roles
 *   creator  — from Creator role (null = no Creator role defined for this model)
 *   assignee — from Assignee role (null = no Assignee role defined for this model)
 *
 * Top-level create/read/update/delete without item context: general | creator | assignee,
 * so assertPermission on list pages passes for Creator/Assignee-only users.
 * After resolvePermissions: accurately reflects the specific item.
 */
export interface RichPermissions extends OperationFlags {
  general: OperationFlags;
  creator: OperationFlags | null;
  assignee: OperationFlags | null;
}

export type ItemContext = {
  creator_id?: string | null;
  assignee_id?: string | null;
  [key: string]: unknown;
} | null | undefined;

const EMPTY_FLAGS: OperationFlags = { create: false, read: false, update: false, delete: false, import: false };
const READ_ONLY_FLAGS: OperationFlags = { create: false, read: true, update: false, delete: false, import: false };
const SPECIAL_ROLE_NAMES = ['Creator', 'Assignee'] as const;

function mergeFlags(a: OperationFlags, b: OperationFlags): OperationFlags {
  return {
    create: a.create || b.create,
    read: a.read || b.read,
    update: a.update || b.update,
    delete: a.delete || b.delete,
    import: a.import || b.import,
  };
}

/** Strip RichPermissions down to the five effective boolean flags for use in components. */
export async function toPermissions(p: RichPermissions): Promise<ModelPermissions> {
  return { create: p.create, read: p.read, update: p.update, delete: p.delete, import: p.import };
}

/**
 * Apply item-level context to compute final effective permissions.
 * Creator/Assignee roles can grant read/update/delete on items the user owns/is assigned to,
 * but never grant create (which is a model-level operation, not item-level).
 */
export async function resolvePermissions(
  perms: RichPermissions,
  item: ItemContext,
  userId: string,
): Promise<RichPermissions> {
  let { read, update, delete: del } = perms.general;

  if (item && userId) {
    if (item.creator_id === userId && perms.creator) {
      read = read || perms.creator.read;
      update = update || perms.creator.update;
      del = del || perms.creator.delete;
    }
    if (item.assignee_id === userId && perms.assignee) {
      read = read || perms.assignee.read;
      update = update || perms.assignee.update;
      del = del || perms.assignee.delete;
    }
  }

  return {
    create: perms.general.create,
    read,
    update,
    delete: del,
    import: perms.general.import,
    general: perms.general,
    creator: perms.creator,
    assignee: perms.assignee,
  };
}

/**
 * Per-process cache of (userId, model) → permission result (Phase 2 #3 from
 * performance-plan-session.md). The original implementation ran a 3-branch OR
 * permission query (`permission.findMany`) on every server-rendered page and
 * every API call, gated only by the per-request React `cache()` wrapper —
 * which does not dedupe inside a Next.js Route Handler (see
 * `getModelPermissions`'s own doc comment below); this per-process cache is
 * what actually bounds the Route Handler cost across requests. Within one
 * request, `lib/_request_scope.ts`'s `memoizeInRequestScope` now provides
 * the real one-call guarantee `cache()`'s comment used to (incorrectly)
 * claim on its own.
 *
 * Trade-off: a user's role/permission change takes effect within one TTL
 * window. We don't track a roles_version, so changes don't invalidate
 * instantly — `invalidatePermissionCache()` is exposed for callers that need
 * tighter bounds (admin tools, role-mutation endpoints).
 *
 * Gated on NODE_ENV === 'production' — which is always true here: `next build`
 * bakes NODE_ENV=production into the bundle regardless of the runtime env
 * (.env.test's NODE_ENV=test is not honored by a built server), so the cache
 * is effectively always on for `cy:test:api` runs too. `cy.task('db:reset')`
 * resets the DB between tests but cannot reach into the server's process to
 * clear this cache; without an explicit clear, a stale cached entry would
 * silently widen permissions for the next run — see
 * `invalidatePermissionCache()` below, invoked via the
 * `/api/test-utils/reset-caches` endpoint.
 */
const PERMISSION_TTL_MS = 30 * 1000;
const PERMISSION_MAX_ENTRIES = 1000;
const permissionCacheEnabled = process.env.NODE_ENV === 'production';
type PermissionEntry = { permissions: RichPermissions; userId: string };
const permissionCache = new TtlLruCache<string, PermissionEntry>(PERMISSION_MAX_ENTRIES, PERMISSION_TTL_MS);

type PermissionRow = {
  name: string;
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
  role: { name: string } | null;
};

/**
 * Per-process cache of userId → every permission row relevant to that user,
 * across ALL models (not just one). Backs `getPermissionRowsForUser` below.
 * Same TTL/size bounds as `permissionCache`; both are cleared together by
 * `invalidatePermissionCache()`.
 */
const permissionRowsCache = new TtlLruCache<string, PermissionRow[]>(PERMISSION_MAX_ENTRIES, PERMISSION_TTL_MS);

/**
 * Fetch every permission row relevant to a user in a single query, instead of
 * one `findMany` per model. `getModelPermissions` used to filter by
 * `name: model` in the query itself, so a caller that asks about N models
 * (e.g. a 25-entity cross-entity search) issued N separate queries. Dropping
 * the `name` filter here and having callers group/filter the single result
 * set by `row.name` collapses that fan-out to one query per (request, user)
 * — the existing 3-branch OR (global / role-membership / special-role) is
 * unchanged, so which rows come back for a given model is identical to
 * before.
 *
 * Layered caching, same shape as `getModelPermissions`: request-scope
 * memoization (`memoizeInRequestScope`, dedups every model a request asks
 * about into the same call — works in Route Handlers as well as Server
 * Components/Actions, unlike the React `cache()` wrapper this function also
 * carries, which only dedupes inside a React render tree), then per-process
 * TTL LRU (`permissionRowsCache`, deduplicates across requests until expiry).
 */
export const getPermissionRowsForUser = cache((resolvedUserId: string): Promise<PermissionRow[]> => {
  return memoizeInRequestScope(`permRows|${resolvedUserId}`, async () => {
    if (permissionCacheEnabled) {
      const cached = permissionRowsCache.get(resolvedUserId);
      if (cached) return cached;
    }

    const rows = await prisma.permission.findMany({
      where: {
        OR: [
          { role_id: null }, // Global permissions (no role)
          // Regular roles the user belongs to, excluding special roles
          {
            role: {
              users: { some: { id: resolvedUserId } },
              name: { notIn: [...SPECIAL_ROLE_NAMES] },
            },
          },
          // Always fetch all special role definitions for deferred item-level resolution
          { role: { name: { in: [...SPECIAL_ROLE_NAMES] } } },
        ],
      },
      select: {
        name: true,
        create: true,
        read: true,
        update: true,
        delete: true,
        import: true,
        role: { select: { name: true } },
      },
    });

    if (permissionCacheEnabled) permissionRowsCache.set(resolvedUserId, rows);
    return rows;
  });
});

export async function invalidatePermissionCache(): Promise<void> {
  permissionCache.clear();
  permissionRowsCache.clear();
}

/**
 * Pure (no DB access) grouping of a set of permission rows (already filtered
 * to one model, e.g. via
 * `getPermissionRowsForUser(userId).filter(row => row.name === model)`) into
 * the general/creator/assignee RichPermissions shape. `async` only because
 * this file is a `'use server'` module, where every exported function is a
 * Server Action and Server Actions must be async — there is no actual
 * asynchronous work inside.
 *
 * Shared by `getModelPermissions` below and by `buildSearchQuery`
 * (search_helpers.ts.jinja2) so the merge rule (general OR creator OR
 * assignee for read/update/delete; general-only for create/import) is
 * defined in exactly one place. Does not itself query the DB or apply the
 * `audit_log` / SELF_ONLY_ADMIN_BYPASS_ENTITIES fallbacks below — those are
 * single-model, DB-querying special cases that cross-entity search never
 * needs (search already applies its own x-self-only handling directly in
 * the template, with no admin-bypass path).
 */
export async function deriveRichPermissionsFromRows(rows: PermissionRow[]): Promise<RichPermissions> {
  if (rows.length === 0) {
    return { ...EMPTY_FLAGS, general: { ...EMPTY_FLAGS }, creator: null, assignee: null };
  }

  let general = { ...EMPTY_FLAGS };
  let creatorFlags: OperationFlags | null = null;
  let assigneeFlags: OperationFlags | null = null;

  for (const row of rows) {
    const flags: OperationFlags = {
      create: row.create,
      read: row.read,
      update: row.update,
      delete: row.delete,
      import: row.import,
    };
    const roleName = row.role?.name;
    if (roleName === 'Creator') {
      creatorFlags = creatorFlags ? mergeFlags(creatorFlags, flags) : { ...flags };
    } else if (roleName === 'Assignee') {
      assigneeFlags = assigneeFlags ? mergeFlags(assigneeFlags, flags) : { ...flags };
    } else {
      general = mergeFlags(general, flags);
    }
  }

  // Top-level flags: broadest possible without item context.
  // create/import are general-only (special roles are item-scoped, not meaningful
  // for new items or bulk import). read/update/delete include special roles so
  // assertPermission passes for Creator/Assignee-only users on list pages.
  return {
    create: general.create,
    read: general.read || (creatorFlags?.read ?? false) || (assigneeFlags?.read ?? false),
    update: general.update || (creatorFlags?.update ?? false) || (assigneeFlags?.update ?? false),
    delete: general.delete || (creatorFlags?.delete ?? false) || (assigneeFlags?.delete ?? false),
    import: general.import,
    general,
    creator: creatorFlags,
    assignee: assigneeFlags,
  };
}

/**
 * Fetch permissions for a model and return them together with the resolved userId.
 * Returning userId avoids a separate getSessionUserId() call in callers and
 * enables fully parallel fetching alongside entity data.
 *
 * Layered caching: request-scope memoization (`memoizeInRequestScope`,
 * dedups concurrent AND sequential calls within one request — Route
 * Handler, Server Action, or Server Component render alike), then
 * per-process TTL LRU (`permissionCache`, deduplicates across requests
 * until expiry). The underlying row fetch is itself batched across every
 * model a request asks about — see `getPermissionRowsForUser`.
 *
 * This is the ONLY place in the generated app that queries the DB for a
 * user's permissions — `requireApiPermission`/`requirePermission`/
 * `canAccess` all resolve through this one function (see their own doc
 * comments), so a request that asks about the same (model, userId) more
 * than once (e.g. a capabilities endpoint checking read, then update, then
 * delete on one item) issues at most one `permission.findMany` for it,
 * not one per call.
 *
 * Still wrapped in React `cache()` too: harmless where it already worked
 * (Server Component render trees dedupe there before this function's body
 * even runs), and a no-op fallback path when `memoizeInRequestScope` finds
 * no active request scope (see that module's own doc comment).
 */
export const getModelPermissions = cache(async (
  model: ModelName,
  userId?: string | null,
): Promise<{ permissions: RichPermissions; userId: string | null }> => {
  const resolvedUserId = userId ?? (await getSessionUserId());
  const empty = { ...EMPTY_FLAGS, general: { ...EMPTY_FLAGS }, creator: null, assignee: null };
  if (!resolvedUserId) {
    return { permissions: empty, userId: null };
  }

  return memoizeInRequestScope(`modelPerms|${resolvedUserId}|${model}`, async () => {
    const cacheKey = `${resolvedUserId}|${model}`;
    if (permissionCacheEnabled) {
      const cached = permissionCache.get(cacheKey);
      if (cached) return cached;
    }

    // audit_log is a system-admin capability. Users holding the 'Administrator' role
    // get full CRUD access without an explicit permission record, so audit_log does
    // not appear in the user-facing permission list (permission.cy.ts count stays at 6).
    if (model === 'audit_log') {
      const adminRoleCount = await prisma.role.count({
        where: { name: 'Administrator', users: { some: { id: resolvedUserId } } },
      });
      if (adminRoleCount > 0) {
        const adminPerms: RichPermissions = { ...READ_ONLY_FLAGS, general: READ_ONLY_FLAGS, creator: null, assignee: null };
        const result = { permissions: adminPerms, userId: resolvedUserId };
        if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
        return result;
      }
    }

    const allRows = await getPermissionRowsForUser(resolvedUserId);
    const rows = allRows.filter((row) => row.name === model);

    if (rows.length === 0) {
      // x-self-only entities with admin_bypass:true (cmd_536, e.g. `setting`) are
      // deliberately excluded from ALL_ENTITIES-driven permission grants — there is
      // nothing to "grant" for a self-service, per-user entity — so they never have
      // an explicit permission row for anyone. Without this fallback, the
      // privileged role's item-level bypass — trySelfOnlyAdminBypass(), which
      // independently re-checks role membership and writes the audit row inside
      // each entity's own getters — would never even be reached: this coarse
      // operation-level check would deny first. Only a READ shortcut is granted
      // (mirroring audit_log above) — there is no admin bypass on write for these
      // entities. Checked only in the no-rows branch so it can never shadow a real
      // grant (e.g. `dashboard`, an ordinary entity that IS in ALL_ENTITIES and can
      // have full CRUD granted through the ordinary path above).
      if (SELF_ONLY_ADMIN_BYPASS_ENTITIES.has(model)) {
        const adminRoleCount = await prisma.role.count({
          where: { name: 'Administrator', users: { some: { id: resolvedUserId } } },
        });
        if (adminRoleCount > 0) {
          const adminPerms: RichPermissions = { ...READ_ONLY_FLAGS, general: READ_ONLY_FLAGS, creator: null, assignee: null };
          const result = { permissions: adminPerms, userId: resolvedUserId };
          if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
          return result;
        }
      }
      // Default: deny all if no explicit permissions
      const full = await deriveRichPermissionsFromRows([]);
      const result = { permissions: full, userId: resolvedUserId };
      if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
      return result;
    }

    const permissions = await deriveRichPermissionsFromRows(rows);
    const result = { permissions, userId: resolvedUserId };
    if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
    return result;
  });
});

export async function canAccess(
  model: ModelName,
  operation: Operation,
  userId?: string | null,
  item?: ItemContext,
): Promise<boolean> {
  const { permissions, userId: resolvedUserId } = await getModelPermissions(model, userId);
  if (!item || !resolvedUserId) return Boolean(permissions[operation]);
  return Boolean((await resolvePermissions(permissions, item, resolvedUserId))[operation]);
}

/**
 * Assert permission, fetching it internally. Accepts an optional explicit userId
 * (for API key auth) or falls back to the session user.
 * Returns the resolved RichPermissions for use in filtering.
 */
export async function requirePermission(
  model: ModelName,
  operation: Operation,
  item?: ItemContext,
  userId?: string | null,
): Promise<RichPermissions> {
  const { permissions, userId: resolvedUserId } = await getModelPermissions(model, userId);
  const resolved = item && resolvedUserId
    ? await resolvePermissions(permissions, item, resolvedUserId)
    : permissions;
  if (!resolved[operation]) {
    throw new AppError('PERMISSION_DENIED', `Access denied: ${model}.${operation}`);
  }
  return resolved;
}

export async function assertPermission(permissions: OperationFlags, operation: Operation, model?: ModelName): Promise<void> {
  if (!permissions[operation]) {
    throw new Error(`Access denied: ${model ?? 'model'}.${operation}`);
  }
}

/** Returns the IDs of all roles the current user (or given userId) belongs to.
 * Request-scope memoized (see `getModelPermissions`'s doc comment) so a
 * request that asks more than once (e.g. once per pending approval sibling
 * in a capabilities check) issues at most one `user.findUnique` for it. */
export const getUserRoleIds = cache((userId?: string | null): Promise<string[]> => {
  return memoizeInRequestScope(`userRoleIds|${userId ?? '(session)'}`, async () => {
    const resolvedUserId = userId ?? await getSessionUserId();
    if (!resolvedUserId) return [];
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { roles: { select: { id: true } } },
    });
    return user?.roles.map(r => r.id) ?? [];
  });
});
