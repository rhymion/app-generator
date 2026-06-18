'use server';

import prisma from '@/lib/prisma';
import type { Work, WorkDetail } from '@/lib/work/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'title', 'pattern', 'status', 'channelable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'title', 'pattern', 'status', 'channelable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildWorkAccessWhere(
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

export async function getWorkDetail(id: string): Promise<WorkDetail | null> {
  const work = await prisma.work.findUnique({
    where: {
      id,
    },
    include: {
      characters: { include: { work: true } }, scenes: { include: { work: true } }, channelable: true, fc_linkable: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!work) {
    return null;
  }

  return {
    ...work,
  };
}

export async function getWorkDetailPageData(id: string, operation: Operation = 'read') {
  const [work, { permissions: basePermissions, userId }] = await Promise.all([
    getWorkDetail(id),
    getModelPermissions('work'),
  ]);
  const resolved = await resolvePermissions(basePermissions, work, userId ?? '');
  await assertPermission(resolved, operation, 'work');
  return { work, userPermissions: await toPermissions(resolved) };
}

export async function getWorkNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('work');
  await assertPermission(richPermissions.general, 'create', 'work');
  return richPermissions.general;
}

/**
 * Paginated query for work — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getWorkPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Work>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildWorkAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.work.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.work.count({ where }),
  ]);

  const rows = rowsRaw.map((work) => ({
    id: work.id,
    title: work.title,
    pattern: work.pattern,
    status: work.status,
    channelable_id: work.channelable_id,
    fc_linkable_id: work.fc_linkable_id,
    creator_id: work.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getWorkPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('work');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'work');
  }
  const pageData = await getWorkPage(opts, permissions, userId);
  return { workPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchWorkPage(opts: PageOpts): Promise<PageResult<Work>> {
  const { permissions, userId } = await getModelPermissions('work');
  await assertPermission(permissions, 'read', 'work');
  return getWorkPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchWorkOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Work[]> {
  const { permissions, userId } = await getModelPermissions('work');
  await assertPermission(permissions, 'read', 'work');
  const accessAnd = buildWorkAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.work.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((work) => ({
    id: work.id,
    title: work.title,
    pattern: work.pattern,
    status: work.status,
    channelable_id: work.channelable_id,
    fc_linkable_id: work.fc_linkable_id,
    creator_id: work.creator_id,
  }));
}
