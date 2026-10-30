// Plain internal module -- no module-level directive on purpose. These helpers
// trust the permissions / actor passed in by the caller, so they must only be
// called by code that has already derived them from the session or an
// authenticated API key. Keep them out of the server-function module in
// ./getters.ts.
import prisma from '@/lib/prisma';
import type { AuditLog, AuditLogDetail } from '@/lib/audit_log/types';
import type { RichPermissions } from '@/lib/authz';
import { type PageOpts, type PageResult, clampPage, buildOrderBy, buildFilter } from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'target_table', 'target_id', 'action', 'actor_user_id', 'created_at']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'target_table', 'target_id', 'action', 'actor_user_id', 'created_at']);

// The actor relation exposes only what the UI renders (the display name).
const ACTOR_USER_SELECT = { id: true, name: true } as const;

/** Build the where clauses that enforce read scope. */
export function buildAuditLogAccessWhere(
  perms: RichPermissions,
  _userId: string | null,
): Record<string, unknown>[] {
  const and: Record<string, unknown>[] = [];
  if (!perms.general.read) {
    and.push({ id: '__no_access__' });
  }
  return and;
}

// findFirst, not findUnique: the primary key is (id, created_at) (the table is
// partitioned on created_at), and ids are cuids, unique on their own.
export async function getAuditLogDetail(id: string): Promise<AuditLogDetail | null> {
  const auditLog = await prisma.audit_log.findFirst({
    where: { id },
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
  const accessAnd = buildAuditLogAccessWhere(perms, userId);
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
