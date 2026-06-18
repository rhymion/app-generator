'use server';

import prisma from '@/lib/prisma';
import type { TipTx, TipTxDetail } from '@/lib/tip_tx/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'gross_amount', 'operator_fee', 'payment_fee', 'contract_split_id', 'status', 'comment_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'gross_amount', 'operator_fee', 'payment_fee', 'contract_split_id', 'status', 'comment_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildTipTxAccessWhere(
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

export async function getTipTxDetail(id: string): Promise<TipTxDetail | null> {
  const tipTx = await prisma.tip_tx.findUnique({
    where: {
      id,
    },
    include: {
      comment: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!tipTx) {
    return null;
  }

  return {
    ...tipTx,
    updated_at: tipTx.updated_at
      ? tipTx.updated_at.toISOString().replace('T', ' ').slice(0, 19)
      : '',
  };
}

export async function getTipTxDetailPageData(id: string, operation: Operation = 'read') {
  const [tipTx, { permissions: basePermissions, userId }] = await Promise.all([
    getTipTxDetail(id),
    getModelPermissions('tip_tx'),
  ]);
  const resolved = await resolvePermissions(basePermissions, tipTx, userId ?? '');
  await assertPermission(resolved, operation, 'tip_tx');
  return { tipTx, userPermissions: await toPermissions(resolved) };
}

export async function getTipTxNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('tip_tx');
  await assertPermission(richPermissions.general, 'create', 'tip_tx');
  return richPermissions.general;
}

/**
 * Paginated query for tip_tx — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getTipTxPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<TipTx>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildTipTxAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.tip_tx.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { comment: true },
    }),
    prisma.tip_tx.count({ where }),
  ]);

  const rows = rowsRaw.map((tipTx) => ({
    id: tipTx.id,
    gross_amount: tipTx.gross_amount,
    operator_fee: tipTx.operator_fee,
    payment_fee: tipTx.payment_fee,
    contract_split_id: tipTx.contract_split_id,
    status: tipTx.status,
    comment_id: tipTx.comment_id,
    creator_id: tipTx.creator_id,
    updated_at: tipTx.updated_at
      ? tipTx.updated_at.toISOString().replace('T', ' ').slice(0, 19)
      : '',
    comment: tipTx.comment,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getTipTxPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('tip_tx');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'tip_tx');
  }
  const pageData = await getTipTxPage(opts, permissions, userId);
  return { tipTxPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchTipTxPage(opts: PageOpts): Promise<PageResult<TipTx>> {
  const { permissions, userId } = await getModelPermissions('tip_tx');
  await assertPermission(permissions, 'read', 'tip_tx');
  return getTipTxPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchTipTxOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<TipTx[]> {
  const { permissions, userId } = await getModelPermissions('tip_tx');
  await assertPermission(permissions, 'read', 'tip_tx');
  const accessAnd = buildTipTxAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.tip_tx.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
    include: { comment: true },
  });
  return rowsRaw.map((tipTx) => ({
    id: tipTx.id,
    gross_amount: tipTx.gross_amount,
    operator_fee: tipTx.operator_fee,
    payment_fee: tipTx.payment_fee,
    contract_split_id: tipTx.contract_split_id,
    status: tipTx.status,
    comment_id: tipTx.comment_id,
    creator_id: tipTx.creator_id,
    updated_at: tipTx.updated_at
      ? tipTx.updated_at.toISOString().replace('T', ' ').slice(0, 19)
      : '',
    comment: tipTx.comment,
  }));
}
