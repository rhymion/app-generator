'use server';

import prisma from '@/lib/prisma';
import type { Music, MusicDetail } from '@/lib/music/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'title', 'kind', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'title', 'kind', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildMusicAccessWhere(
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

export async function getMusicDetail(id: string): Promise<MusicDetail | null> {
  const music = await prisma.music.findUnique({
    where: {
      id,
    },
    include: {
      scenes: { include: { work: true } }, composers: true, credits: true, fc_linkable: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!music) {
    return null;
  }

  return {
    ...music,
  };
}

export async function getMusicDetailPageData(id: string, operation: Operation = 'read') {
  const [music, { permissions: basePermissions, userId }] = await Promise.all([
    getMusicDetail(id),
    getModelPermissions('music'),
  ]);
  const resolved = await resolvePermissions(basePermissions, music, userId ?? '');
  await assertPermission(resolved, operation, 'music');
  return { music, userPermissions: await toPermissions(resolved) };
}

export async function getMusicNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('music');
  await assertPermission(richPermissions.general, 'create', 'music');
  return richPermissions.general;
}

/**
 * Paginated query for music — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getMusicPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Music>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildMusicAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.music.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.music.count({ where }),
  ]);

  const rows = rowsRaw.map((music) => ({
    id: music.id,
    title: music.title,
    kind: music.kind,
    fc_linkable_id: music.fc_linkable_id,
    creator_id: music.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getMusicPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('music');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'music');
  }
  const pageData = await getMusicPage(opts, permissions, userId);
  return { musicPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchMusicPage(opts: PageOpts): Promise<PageResult<Music>> {
  const { permissions, userId } = await getModelPermissions('music');
  await assertPermission(permissions, 'read', 'music');
  return getMusicPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchMusicOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Music[]> {
  const { permissions, userId } = await getModelPermissions('music');
  await assertPermission(permissions, 'read', 'music');
  const accessAnd = buildMusicAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.music.findMany({
    where,
    orderBy: [{ id: 'desc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((music) => ({
    id: music.id,
    title: music.title,
    kind: music.kind,
    fc_linkable_id: music.fc_linkable_id,
    creator_id: music.creator_id,
  }));
}
