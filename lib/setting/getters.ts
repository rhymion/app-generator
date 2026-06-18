'use server';

import prisma from '@/lib/prisma';
import type { Setting, SettingDetail } from '@/lib/setting/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'email', 'password', 'api_key', 'image', 'mfa_enabled', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'email', 'password', 'api_key', 'image', 'mfa_enabled', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildSettingAccessWhere(
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

export async function getSettingDetail(id: string): Promise<SettingDetail | null> {
  const setting = await prisma.user.findUnique({
    where: {
      id,
    },
    include: {
      roles: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting) {
    return null;
  }

  return {
    ...setting,
  };
}

export async function getSettingDetailPageData(id: string, operation: Operation = 'read') {
  const [setting, { permissions: basePermissions, userId }] = await Promise.all([
    getSettingDetail(id),
    getModelPermissions('setting'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting, userId ?? '');
  await assertPermission(resolved, operation, 'setting');
  return { setting, userPermissions: await toPermissions(resolved) };
}

export async function getSettingNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting');
  await assertPermission(richPermissions.general, 'create', 'setting');
  return richPermissions.general;
}

/**
 * Paginated query for setting — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getSettingPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Setting>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildSettingAccessWhere(perms, userId);
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

  const rows = rowsRaw.map((setting) => ({
    id: setting.id,
    name: setting.name,
    email: setting.email,
    password: setting.password,
    api_key: setting.api_key,
    image: setting.image,
    mfa_enabled: setting.mfa_enabled,
    creator_id: setting.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getSettingPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('setting');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'setting');
  }
  const pageData = await getSettingPage(opts, permissions, userId);
  return { settingPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchSettingPage(opts: PageOpts): Promise<PageResult<Setting>> {
  const { permissions, userId } = await getModelPermissions('setting');
  await assertPermission(permissions, 'read', 'setting');
  return getSettingPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchSettingOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Setting[]> {
  const { permissions, userId } = await getModelPermissions('setting');
  await assertPermission(permissions, 'read', 'setting');
  const accessAnd = buildSettingAccessWhere(permissions, userId);

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
  return rowsRaw.map((setting) => ({
    id: setting.id,
    name: setting.name,
    email: setting.email,
    password: setting.password,
    api_key: setting.api_key,
    image: setting.image,
    mfa_enabled: setting.mfa_enabled,
    creator_id: setting.creator_id,
  }));
}
