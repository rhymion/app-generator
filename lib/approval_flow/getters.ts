'use server';

import prisma from '@/lib/prisma';
import type { ApprovalFlow, ApprovalFlowDetail } from '@/lib/approval_flow/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'entity_name', 'requestor_role_id', 'approver_role_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'entity_name', 'requestor_role_id', 'approver_role_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildApprovalFlowAccessWhere(
  perms: RichPermissions,
  userId: string | null,
): Record<string, unknown>[] {
  const and: Record<string, unknown>[] = [];
  if (!perms.general.read) {
    const or: Record<string, unknown>[] = [];
    if (perms.creator?.read && userId) or.push({ creator_id: userId });
    if (or.length === 0) {
      // No read scope at all — force empty result without throwing here.
      and.push({ id: '__no_access__' });
    } else {
      and.push({ OR: or });
    }
  }
  return and;
}

export async function getApprovalFlowDetail(id: string): Promise<ApprovalFlowDetail | null> {
  const approvalFlow = await prisma.approval_flow.findUnique({
    where: {
      id,
    },
    include: {
      preceded_by: { include: { requestor_role: true, approver_role: true } }, followed_by: { include: { requestor_role: true, approver_role: true } }, requestor_role: true, approver_role: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!approvalFlow) {
    return null;
  }

  return {
    ...approvalFlow,
  };
}

export async function getApprovalFlowDetailPageData(id: string, operation: Operation = 'read') {
  const [approvalFlow, { permissions: basePermissions, userId }] = await Promise.all([
    getApprovalFlowDetail(id),
    getModelPermissions('approval_flow'),
  ]);
  const resolved = await resolvePermissions(basePermissions, approvalFlow, userId ?? '');
  await assertPermission(resolved, operation, 'approval_flow');
  return { approvalFlow, userPermissions: await toPermissions(resolved) };
}

export async function getApprovalFlowNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('approval_flow');
  await assertPermission(richPermissions.general, 'create', 'approval_flow');
  return richPermissions.general;
}

/**
 * Paginated query for approval_flow — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getApprovalFlowPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<ApprovalFlow>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildApprovalFlowAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.approval_flow.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { requestor_role: true, approver_role: true },
    }),
    prisma.approval_flow.count({ where }),
  ]);

  const rows = rowsRaw.map((approvalFlow) => ({
    id: approvalFlow.id,
    entity_name: approvalFlow.entity_name,
    requestor_role_id: approvalFlow.requestor_role_id,
    approver_role_id: approvalFlow.approver_role_id,
    creator_id: approvalFlow.creator_id,
    requestor_role: approvalFlow.requestor_role,
    approver_role: approvalFlow.approver_role,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getApprovalFlowPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('approval_flow');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'approval_flow');
  }
  const pageData = await getApprovalFlowPage(opts, permissions, userId);
  return { approvalFlowPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchApprovalFlowPage(opts: PageOpts): Promise<PageResult<ApprovalFlow>> {
  const { permissions, userId } = await getModelPermissions('approval_flow');
  await assertPermission(permissions, 'read', 'approval_flow');
  return getApprovalFlowPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchApprovalFlowOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<ApprovalFlow[]> {
  const { permissions, userId } = await getModelPermissions('approval_flow');
  await assertPermission(permissions, 'read', 'approval_flow');
  const accessAnd = buildApprovalFlowAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.approval_flow.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
    include: { requestor_role: true, approver_role: true },
  });
  return rowsRaw.map((approvalFlow) => ({
    id: approvalFlow.id,
    entity_name: approvalFlow.entity_name,
    requestor_role_id: approvalFlow.requestor_role_id,
    approver_role_id: approvalFlow.approver_role_id,
    creator_id: approvalFlow.creator_id,
    requestor_role: approvalFlow.requestor_role,
    approver_role: approvalFlow.approver_role,
  }));
}
