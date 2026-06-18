'use server';

import prisma from '@/lib/prisma';
import type { Plan, PlanDetail } from '@/lib/plan/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'tier', 'reaction_kinds_allowed', 'sub_account_limit', 'can_view_paid_posts', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'tier', 'reaction_kinds_allowed', 'sub_account_limit', 'can_view_paid_posts', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildPlanAccessWhere(
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

export async function getPlanDetail(id: string): Promise<PlanDetail | null> {
  const plan = await prisma.plan.findUnique({
    where: {
      id,
    },
    include: {
      users: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!plan) {
    return null;
  }

  return {
    ...plan,
  };
}

export async function getPlanDetailPageData(id: string, operation: Operation = 'read') {
  const [plan, { permissions: basePermissions, userId }] = await Promise.all([
    getPlanDetail(id),
    getModelPermissions('plan'),
  ]);
  const resolved = await resolvePermissions(basePermissions, plan, userId ?? '');
  await assertPermission(resolved, operation, 'plan');
  return { plan, userPermissions: await toPermissions(resolved) };
}

export async function getPlanNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('plan');
  await assertPermission(richPermissions.general, 'create', 'plan');
  return richPermissions.general;
}

/**
 * Paginated query for plan — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getPlanPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Plan>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildPlanAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.plan.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.plan.count({ where }),
  ]);

  const rows = rowsRaw.map((plan) => ({
    id: plan.id,
    tier: plan.tier,
    reaction_kinds_allowed: plan.reaction_kinds_allowed,
    sub_account_limit: plan.sub_account_limit,
    can_view_paid_posts: plan.can_view_paid_posts,
    creator_id: plan.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getPlanPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('plan');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'plan');
  }
  const pageData = await getPlanPage(opts, permissions, userId);
  return { planPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchPlanPage(opts: PageOpts): Promise<PageResult<Plan>> {
  const { permissions, userId } = await getModelPermissions('plan');
  await assertPermission(permissions, 'read', 'plan');
  return getPlanPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchPlanOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Plan[]> {
  const { permissions, userId } = await getModelPermissions('plan');
  await assertPermission(permissions, 'read', 'plan');
  const accessAnd = buildPlanAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.plan.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((plan) => ({
    id: plan.id,
    tier: plan.tier,
    reaction_kinds_allowed: plan.reaction_kinds_allowed,
    sub_account_limit: plan.sub_account_limit,
    can_view_paid_posts: plan.can_view_paid_posts,
    creator_id: plan.creator_id,
  }));
}
