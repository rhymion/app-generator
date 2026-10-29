'use server';

import prisma from '@/lib/prisma';
import type { AuditLog, AuditLogDetail } from '@/lib/audit_log/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'target_table', 'target_id', 'action', 'actor_user_id', 'created_at']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'target_table', 'target_id', 'action', 'actor_user_id', 'created_at']);

// The actor relation exposes only what the UI renders (the display name).
const ACTOR_USER_SELECT = { id: true, name: true } as const;

/**
 * Organization scope of an audit row. `audit_log` has no organization column (a row can describe an
 * unauthenticated event or a system table), so a row belongs to the organizations of the user who
 * caused it. A caller reaches a row only when the actor shares an organization with the caller.
 * A caller with no organization reaches only rows that belong to no organization (no actor, or an
 * actor with no organization), so one organization's trail is never readable from another.
 */
async function buildAuditLogOrganizationWhere(userId: string | null): Promise<Record<string, unknown>> {
  const organizationIds = userId ? (await getAssociatedOrganizations(userId)).map((o) => o.id) : [];
  if (organizationIds.length > 0) {
    return { actor_user: { organizations: { some: { id: { in: organizationIds } } } } };
  }
  return { OR: [{ actor_user_id: null }, { actor_user: { organizations: { none: {} } } }] };
}

/** Build the where clauses that enforce read scope. */
async function buildAuditLogAccessWhere(
  perms: RichPermissions,
  userId: string | null,
): Promise<Record<string, unknown>[]> {
  const and: Record<string, unknown>[] = [await buildAuditLogOrganizationWhere(userId)];
  if (!perms.general.read) {
    and.push({ id: '__no_access__' });
  }
  return and;
}

// findFirst, not findUnique: the primary key is (id, created_at) (the table is
// partitioned on created_at), and ids are cuids, unique on their own.
export async function getAuditLogDetail(id: string, userId: string | null): Promise<AuditLogDetail | null> {
  const auditLog = await prisma.audit_log.findFirst({
    where: { AND: [{ id }, await buildAuditLogOrganizationWhere(userId)] },
    include: {
      actor_user: { select: ACTOR_USER_SELECT },
    },
  });

  if (!auditLog) {
    return null;
  }

  return {
    ...auditLog,
    metadata: auditLog.metadata as Record<string, unknown> | null,
  };
}

// findFirst, not findUnique: the primary key is (id, created_at) (the table is
// partitioned on created_at), and ids are cuids, unique on their own.
export async function getAuditLogDetailPageData(id: string, operation: Operation = 'read') {
  const { permissions: basePermissions, userId } = await getModelPermissions('audit_log');
  const auditLog = await getAuditLogDetail(id, userId);
  const resolved = await resolvePermissions(basePermissions, auditLog, userId ?? '');
  await assertPermission(resolved, operation, 'audit_log');
  return { auditLog, userPermissions: await toPermissions(resolved) };
}

export async function getAuditLogNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('audit_log');
  await assertPermission(richPermissions.general, 'create', 'audit_log');
  return richPermissions.general;
}

/**
 * Paginated query for audit_log — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getAuditLogPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<AuditLog>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = await buildAuditLogAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.audit_log.findMany({ where, orderBy, skip, take,
      include: { actor_user: { select: ACTOR_USER_SELECT } },
    }),
    prisma.audit_log.count({ where }),
  ]);

  const rows = rowsRaw.map((auditLog) => ({
    id: auditLog.id,
    target_table: auditLog.target_table,
    target_id: auditLog.target_id,
    action: auditLog.action,
    actor_user_id: auditLog.actor_user_id,
    metadata: auditLog.metadata as Record<string, unknown> | null,
    created_at: auditLog.created_at,
    actor_user: auditLog.actor_user,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getAuditLogPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('audit_log');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'audit_log');
  }
  const pageData = await getAuditLogPage(opts, permissions, userId);
  return { auditLogPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchAuditLogPage(opts: PageOpts): Promise<PageResult<AuditLog>> {
  const { permissions, userId } = await getModelPermissions('audit_log');
  await assertPermission(permissions, 'read', 'audit_log');
  return getAuditLogPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchAuditLogOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<AuditLog[]> {
  const { permissions, userId } = await getModelPermissions('audit_log');
  await assertPermission(permissions, 'read', 'audit_log');
  const accessAnd = await buildAuditLogAccessWhere(permissions, userId);

  const trimmed = query.trim();
  const orClauses: Record<string, unknown>[] = [];
  if (trimmed) {
  }
  if (includeIds.length > 0) {
    orClauses.push({ id: { in: includeIds } });
  }
  const where = {
    AND: [
      ...accessAnd,
      ...(orClauses.length > 0 ? [{ OR: orClauses }] : []),
    ],
  };
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
  const rowsRaw = await prisma.audit_log.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((auditLog) => ({
    id: auditLog.id,
    target_table: auditLog.target_table,
    target_id: auditLog.target_id,
    action: auditLog.action,
    actor_user_id: auditLog.actor_user_id,
    metadata: auditLog.metadata as Record<string, unknown> | null,
    created_at: auditLog.created_at,
  }));
}
