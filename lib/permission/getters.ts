'use server';

import prisma from '@/lib/prisma';
import type { Permission, PermissionDetail } from '@/lib/permission/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'create', 'read', 'update', 'delete', 'role_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'create', 'read', 'update', 'delete', 'role_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildPermissionAccessWhere(
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

export async function getPermissionDetail(id: string): Promise<PermissionDetail | null> {
  const permission = await prisma.permission.findUnique({
    where: {
      id,
    },
    include: {
      role: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!permission) {
    return null;
  }

  return {
    ...permission,
  };
}

export async function getPermissionDetailPageData(id: string, operation: Operation = 'read') {
  const [permission, { permissions: basePermissions, userId }] = await Promise.all([
    getPermissionDetail(id),
    getModelPermissions('permission'),
  ]);
  const resolved = await resolvePermissions(basePermissions, permission, userId ?? '');
  await assertPermission(resolved, operation, 'permission');
  return { permission, userPermissions: await toPermissions(resolved) };
}

export async function getPermissionNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('permission');
  await assertPermission(richPermissions.general, 'create', 'permission');
  return richPermissions.general;
}

/**
 * Paginated query for permission — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getPermissionPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Permission>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildPermissionAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.permission.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { role: true },
    }),
    prisma.permission.count({ where }),
  ]);

  const rows = rowsRaw.map((permission) => ({
    id: permission.id,
    name: permission.name,
    create: permission.create,
    read: permission.read,
    update: permission.update,
    delete: permission.delete,
    role_id: permission.role_id,
    creator_id: permission.creator_id,
    role: permission.role,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getPermissionPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('permission');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'permission');
  }
  const pageData = await getPermissionPage(opts, permissions, userId);
  return { permissionPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchPermissionPage(opts: PageOpts): Promise<PageResult<Permission>> {
  const { permissions, userId } = await getModelPermissions('permission');
  await assertPermission(permissions, 'read', 'permission');
  return getPermissionPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchPermissionOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Permission[]> {
  const { permissions, userId } = await getModelPermissions('permission');
  await assertPermission(permissions, 'read', 'permission');
  const accessAnd = buildPermissionAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.permission.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
    include: { role: true },
  });
  return rowsRaw.map((permission) => ({
    id: permission.id,
    name: permission.name,
    create: permission.create,
    read: permission.read,
    update: permission.update,
    delete: permission.delete,
    role_id: permission.role_id,
    creator_id: permission.creator_id,
    role: permission.role,
  }));
}
