'use server';

import prisma from '@/lib/prisma';
import type { User, UserDetail } from '@/lib/user/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'image', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'image', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildUserAccessWhere(
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

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    include: {
      roles: true, sub_accounts: { include: { parent_user: true } }, created_works: true, created_characters: { include: { work: true } }, created_scenes: { include: { work: true } }, created_channels: { include: { organization: true } }, created_musics: true, created_creators: true, created_plans: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!user) {
    return null;
  }

  return {
    ...user,
  };
}

export async function getUserDetailPageData(id: string, operation: Operation = 'read') {
  const [user, { permissions: basePermissions, userId }] = await Promise.all([
    getUserDetail(id),
    getModelPermissions('user'),
  ]);
  const resolved = await resolvePermissions(basePermissions, user, userId ?? '');
  await assertPermission(resolved, operation, 'user');
  return { user, userPermissions: await toPermissions(resolved) };
}

export async function getUserNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('user');
  await assertPermission(richPermissions.general, 'create', 'user');
  return richPermissions.general;
}

/**
 * Paginated query for user — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getUserPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<User>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildUserAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  const rows = rowsRaw.map((user) => ({
    id: user.id,
    name: user.name,
    image: user.image,
    creator_id: user.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getUserPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('user');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'user');
  }
  const pageData = await getUserPage(opts, permissions, userId);
  return { userPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchUserPage(opts: PageOpts): Promise<PageResult<User>> {
  const { permissions, userId } = await getModelPermissions('user');
  await assertPermission(permissions, 'read', 'user');
  return getUserPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchUserOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<User[]> {
  const { permissions, userId } = await getModelPermissions('user');
  await assertPermission(permissions, 'read', 'user');
  const accessAnd = buildUserAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.user.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((user) => ({
    id: user.id,
    name: user.name,
    image: user.image,
    creator_id: user.creator_id,
  }));
}
