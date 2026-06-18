'use server';

import prisma from '@/lib/prisma';
import type { Character, CharacterDetail } from '@/lib/character/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'work_id', 'official_image', 'channelable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'work_id', 'official_image', 'channelable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildCharacterAccessWhere(
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

export async function getCharacterDetail(id: string): Promise<CharacterDetail | null> {
  const character = await prisma.character.findUnique({
    where: {
      id,
    },
    include: {
      scenes: { include: { work: true } }, creators: true, work: true, channelable: true, fc_linkable: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!character) {
    return null;
  }

  return {
    ...character,
  };
}

export async function getCharacterDetailPageData(id: string, operation: Operation = 'read') {
  const [character, { permissions: basePermissions, userId }] = await Promise.all([
    getCharacterDetail(id),
    getModelPermissions('character'),
  ]);
  const resolved = await resolvePermissions(basePermissions, character, userId ?? '');
  await assertPermission(resolved, operation, 'character');
  return { character, userPermissions: await toPermissions(resolved) };
}

export async function getCharacterNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('character');
  await assertPermission(richPermissions.general, 'create', 'character');
  return richPermissions.general;
}

/**
 * Paginated query for character — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getCharacterPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Character>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildCharacterAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.character.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { work: true },
    }),
    prisma.character.count({ where }),
  ]);

  const rows = rowsRaw.map((character) => ({
    id: character.id,
    name: character.name,
    work_id: character.work_id,
    official_image: character.official_image,
    channelable_id: character.channelable_id,
    fc_linkable_id: character.fc_linkable_id,
    creator_id: character.creator_id,
    work: character.work,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getCharacterPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('character');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'character');
  }
  const pageData = await getCharacterPage(opts, permissions, userId);
  return { characterPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchCharacterPage(opts: PageOpts): Promise<PageResult<Character>> {
  const { permissions, userId } = await getModelPermissions('character');
  await assertPermission(permissions, 'read', 'character');
  return getCharacterPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchCharacterOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Character[]> {
  const { permissions, userId } = await getModelPermissions('character');
  await assertPermission(permissions, 'read', 'character');
  const accessAnd = buildCharacterAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.character.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
    include: { work: true },
  });
  return rowsRaw.map((character) => ({
    id: character.id,
    name: character.name,
    work_id: character.work_id,
    official_image: character.official_image,
    channelable_id: character.channelable_id,
    fc_linkable_id: character.fc_linkable_id,
    creator_id: character.creator_id,
    work: character.work,
  }));
}
