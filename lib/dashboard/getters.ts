'use server';

import prisma from '@/lib/prisma';
import type { Dashboard, DashboardDetail } from '@/lib/dashboard/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildDashboardAccessWhere(
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

export async function getDashboardDetail(id: string): Promise<DashboardDetail | null> {
  const dashboard = await prisma.dashboard.findUnique({
    where: {
      id,
    },
    include: {
      widgets: { include: { dashboard: true } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!dashboard) {
    return null;
  }

  return {
    ...dashboard,
  };
}

export async function getDashboardDetailPageData(id: string, operation: Operation = 'read') {
  const [dashboard, { permissions: basePermissions, userId }] = await Promise.all([
    getDashboardDetail(id),
    getModelPermissions('dashboard'),
  ]);
  const resolved = await resolvePermissions(basePermissions, dashboard, userId ?? '');
  await assertPermission(resolved, operation, 'dashboard');
  return { dashboard, userPermissions: await toPermissions(resolved) };
}

export async function getDashboardNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('dashboard');
  await assertPermission(richPermissions.general, 'create', 'dashboard');
  return richPermissions.general;
}

/**
 * Paginated query for dashboard — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getDashboardPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Dashboard>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildDashboardAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.dashboard.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.dashboard.count({ where }),
  ]);

  const rows = rowsRaw.map((dashboard) => ({
    id: dashboard.id,
    name: dashboard.name,
    creator_id: dashboard.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getDashboardPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('dashboard');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'dashboard');
  }
  const pageData = await getDashboardPage(opts, permissions, userId);
  return { dashboardPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchDashboardPage(opts: PageOpts): Promise<PageResult<Dashboard>> {
  const { permissions, userId } = await getModelPermissions('dashboard');
  await assertPermission(permissions, 'read', 'dashboard');
  return getDashboardPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchDashboardOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Dashboard[]> {
  const { permissions, userId } = await getModelPermissions('dashboard');
  await assertPermission(permissions, 'read', 'dashboard');
  const accessAnd = buildDashboardAccessWhere(permissions, userId);

  const trimmed = query.trim();
  const orClauses: Record<string, unknown>[] = [];
  if (trimmed) {
    orClauses.push({ name: { contains: trimmed, mode: 'insensitive' } });
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
  const rowsRaw = await prisma.dashboard.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((dashboard) => ({
    id: dashboard.id,
    name: dashboard.name,
    creator_id: dashboard.creator_id,
  }));
}
