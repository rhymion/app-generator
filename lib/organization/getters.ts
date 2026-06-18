'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'description', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'description', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildOrganizationAccessWhere(
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

export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: {
      id,
    },
    include: {
      users: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
  };
}

export async function getOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const [organization, { permissions: basePermissions, userId }] = await Promise.all([
    getOrganizationDetail(id),
    getModelPermissions('organization'),
  ]);
  const resolved = await resolvePermissions(basePermissions, organization, userId ?? '');
  await assertPermission(resolved, operation, 'organization');
  return { organization, userPermissions: await toPermissions(resolved) };
}

export async function getOrganizationNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('organization');
  await assertPermission(richPermissions.general, 'create', 'organization');
  return richPermissions.general;
}

/**
 * Paginated query for organization — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getOrganizationPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Organization>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildOrganizationAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.organization.count({ where }),
  ]);

  const rows = rowsRaw.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getOrganizationPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('organization');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'organization');
  }
  const pageData = await getOrganizationPage(opts, permissions, userId);
  return { organizationPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchOrganizationPage(opts: PageOpts): Promise<PageResult<Organization>> {
  const { permissions, userId } = await getModelPermissions('organization');
  await assertPermission(permissions, 'read', 'organization');
  return getOrganizationPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchOrganizationOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Organization[]> {
  const { permissions, userId } = await getModelPermissions('organization');
  await assertPermission(permissions, 'read', 'organization');
  const accessAnd = buildOrganizationAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.organization.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
}
