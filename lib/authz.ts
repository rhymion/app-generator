'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { cache } from 'react';
import { TtlLruCache } from '@/lib/_ttl_lru';

export const getSessionUserId = cache(async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
});

export async function getSessionUserIdOrThrow(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }
  return userId;
}

export type Operation = 'create' | 'read' | 'update' | 'delete';
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

const EMPTY_FLAGS: OperationFlags = { create: false, read: false, update: false, delete: false };
const FULL_FLAGS: OperationFlags = { create: true, read: true, update: true, delete: true };
const READ_ONLY_FLAGS: OperationFlags = { create: false, read: true, update: false, delete: false };
const SPECIAL_ROLE_NAMES = ['Creator', 'Assignee'] as const;

function mergeFlags(a: OperationFlags, b: OperationFlags): OperationFlags {
  return {
    create: a.create || b.create,
    read: a.read || b.read,
    update: a.update || b.update,
    delete: a.delete || b.delete,
  };
}

/** Strip RichPermissions down to the four effective boolean flags for use in components. */
export async function toPermissions(p: RichPermissions): Promise<ModelPermissions> {
  return { create: p.create, read: p.read, update: p.update, delete: p.delete };
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
    general: perms.general,
    creator: perms.creator,
    assignee: perms.assignee,
  };
}

/**
 * Per-process cache of (userId, model) → permission result (Phase 2 #3 from
 * performance-plan-session.md). The original implementation ran a 3-branch OR
 * permission query (`permission.findMany`) on every server-rendered page and
 * every API call, gated only by the per-request React `cache()` wrapper.
 *
 * Trade-off: a user's role/permission change takes effect within one TTL
 * window. We don't track a roles_version, so changes don't invalidate
 * instantly — `invalidatePermissionCache()` is exposed for callers that need
 * tighter bounds (admin tools, role-mutation endpoints).
 *
 * Gated to production: `cy:test:api` resets the DB between tests but cannot
 * reach into the dev server's process to clear this cache, so a stale
 * cached entry would silently widen permissions for the new run.
 */
const PERMISSION_TTL_MS = 30 * 1000;
const PERMISSION_MAX_ENTRIES = 1000;
const permissionCacheEnabled = process.env.NODE_ENV === 'production';
type PermissionEntry = { permissions: RichPermissions; userId: string };
const permissionCache = new TtlLruCache<string, PermissionEntry>(PERMISSION_MAX_ENTRIES, PERMISSION_TTL_MS);

export async function invalidatePermissionCache(): Promise<void> {
  permissionCache.clear();
}

/**
 * Fetch permissions for a model and return them together with the resolved userId.
 * Returning userId avoids a separate getSessionUserId() call in callers and
 * enables fully parallel fetching alongside entity data.
 *
 * Layered caching: per-request React `cache()` (dedups concurrent calls within
 * one render), then per-process TTL LRU (`permissionCache`, deduplicates across
 * requests until expiry).
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

  const rows = await prisma.permission.findMany({
    where: {
      name: model,
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
      create: true,
      read: true,
      update: true,
      delete: true,
      role: { select: { name: true } },
    },
  });

  if (rows.length === 0) {
    // Default: deny all if no explicit permissions
    const full = { ...EMPTY_FLAGS, general: { ...EMPTY_FLAGS }, creator: null, assignee: null };
    const result = { permissions: full, userId: resolvedUserId };
    if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
    return result;
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
  // create is general-only (special roles are item-scoped, not meaningful for new items).
  // read/update/delete include special roles so assertPermission passes for
  // Creator/Assignee-only users on list pages.
  const permissions: RichPermissions = {
    create: general.create,
    read: general.read || (creatorFlags?.read ?? false) || (assigneeFlags?.read ?? false),
    update: general.update || (creatorFlags?.update ?? false) || (assigneeFlags?.update ?? false),
    delete: general.delete || (creatorFlags?.delete ?? false) || (assigneeFlags?.delete ?? false),
    general,
    creator: creatorFlags,
    assignee: assigneeFlags,
  };
  const result = { permissions, userId: resolvedUserId };
  if (permissionCacheEnabled) permissionCache.set(cacheKey, result);
  return result;
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
    throw new Error(`Access denied: ${model}.${operation}`);
  }
  return resolved;
}

export async function assertPermission(permissions: OperationFlags, operation: Operation, model?: ModelName): Promise<void> {
  if (!permissions[operation]) {
    throw new Error(`Access denied: ${model ?? 'model'}.${operation}`);
  }
}

/** Returns the IDs of all roles the current user (or given userId) belongs to. */
export const getUserRoleIds = cache(async (userId?: string | null): Promise<string[]> => {
  const resolvedUserId = userId ?? await getSessionUserId();
  if (!resolvedUserId) return [];
  const user = await prisma.user.findUnique({
    where: { id: resolvedUserId },
    select: { roles: { select: { id: true } } },
  });
  return user?.roles.map(r => r.id) ?? [];
});
