'use server';

import prisma from '@/lib/prisma';
import type { Creator, CreatorDetail } from '@/lib/creator/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'role', 'affiliation', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'role', 'affiliation', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildCreatorAccessWhere(
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

export async function getCreatorDetail(id: string): Promise<CreatorDetail | null> {
  const creator = await prisma.creator.findUnique({
    where: {
      id,
    },
    include: {
      voiced_characters: { include: { work: true } }, composed_musics: true, credited_musics: true, credited_scenes: { include: { work: true } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!creator) {
    return null;
  }

  return {
    ...creator,
  };
}

export async function getCreatorDetailPageData(id: string, operation: Operation = 'read') {
  const [creator, { permissions: basePermissions, userId }] = await Promise.all([
    getCreatorDetail(id),
    getModelPermissions('creator'),
  ]);
  const resolved = await resolvePermissions(basePermissions, creator, userId ?? '');
  await assertPermission(resolved, operation, 'creator');
  return { creator, userPermissions: await toPermissions(resolved) };
}

export async function getCreatorNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('creator');
  await assertPermission(richPermissions.general, 'create', 'creator');
  return richPermissions.general;
}

/**
 * Paginated query for creator — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getCreatorPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Creator>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildCreatorAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.creator.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.creator.count({ where }),
  ]);

  const rows = rowsRaw.map((creator) => ({
    id: creator.id,
    name: creator.name,
    role: creator.role,
    affiliation: creator.affiliation,
    creator_id: creator.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getCreatorPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('creator');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'creator');
  }
  const pageData = await getCreatorPage(opts, permissions, userId);
  return { creatorPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchCreatorPage(opts: PageOpts): Promise<PageResult<Creator>> {
  const { permissions, userId } = await getModelPermissions('creator');
  await assertPermission(permissions, 'read', 'creator');
  return getCreatorPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchCreatorOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Creator[]> {
  const { permissions, userId } = await getModelPermissions('creator');
  await assertPermission(permissions, 'read', 'creator');
  const accessAnd = buildCreatorAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.creator.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((creator) => ({
    id: creator.id,
    name: creator.name,
    role: creator.role,
    affiliation: creator.affiliation,
    creator_id: creator.creator_id,
  }));
}
