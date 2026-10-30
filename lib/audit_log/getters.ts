'use server';

import prisma from '@/lib/prisma';
import type { AuditLog } from '@/lib/audit_log/types';
import { buildAuditLogAccessWhere, getAuditLogDetail, getAuditLogPage } from '@/lib/audit_log/getters_internal';
import { assertPermission, getModelPermissions, resolveEntityPermissions, resolveRecordPermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE,
} from '@/lib/_pagination';

// findFirst, not findUnique: the primary key is (id, created_at) (the table is
// partitioned on created_at), and ids are cuids, unique on their own.
export async function getAuditLogDetailPageData(id: string, operation: Operation = 'read') {
  const [auditLog, { permissions: basePermissions, userId }] = await Promise.all([
    getAuditLogDetail(id),
    getModelPermissions('audit_log'),
  ]);
  const resolved = auditLog
    ? await resolveRecordPermissions(basePermissions, auditLog, userId ?? '')
    : await resolveEntityPermissions(basePermissions);
  await assertPermission(resolved, operation, 'audit_log');
  return { auditLog, userPermissions: await toPermissions(resolved) };
}

export async function getAuditLogNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('audit_log');
  await assertPermission(richPermissions.general, 'create', 'audit_log');
  return richPermissions.general;
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
  const accessAnd = buildAuditLogAccessWhere(permissions, userId);

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
