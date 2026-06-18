'use server';

import prisma from '@/lib/prisma';
import type { FcLink, FcLinkDetail } from '@/lib/fc_link/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'url', 'created_at', 'updated_at', 'creator_id', 'fc_linkable_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'url', 'created_at', 'updated_at', 'creator_id', 'fc_linkable_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildFcLinkAccessWhere(
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

export async function getFcLinkDetail(id: string): Promise<FcLinkDetail | null> {
  const fcLink = await prisma.fc_link.findUnique({
    where: {
      id,
    },
    include: {
      fc_linkable: { include: { work: { select: { id: true, title: true } }, character: { select: { id: true, name: true } }, music: { select: { id: true, title: true } }, channel: { select: { id: true, name: true } } } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!fcLink) {
    return null;
  }

  return {
    ...fcLink,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return 'music';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return 'channel';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return String(((fcLink as any).fc_linkable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return String(((fcLink as any).fc_linkable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return String(((fcLink as any).fc_linkable)?.music.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return String(((fcLink as any).fc_linkable)?.channel.name ?? '');
      return null;
    })(),
  };
}

export async function getFcLinkDetailPageData(id: string, operation: Operation = 'read') {
  const [fcLink, { permissions: basePermissions, userId }] = await Promise.all([
    getFcLinkDetail(id),
    getModelPermissions('fc_link'),
  ]);
  const resolved = await resolvePermissions(basePermissions, fcLink, userId ?? '');
  await assertPermission(resolved, operation, 'fc_link');
  return { fcLink, userPermissions: await toPermissions(resolved) };
}

export async function getFcLinkNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('fc_link');
  await assertPermission(richPermissions.general, 'create', 'fc_link');
  return richPermissions.general;
}

/**
 * Paginated query for fc_link — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getFcLinkPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<FcLink>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildFcLinkAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.fc_link.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { fc_linkable: { include: { work: { select: { id: true, title: true } }, character: { select: { id: true, name: true } }, music: { select: { id: true, title: true } }, channel: { select: { id: true, name: true } } } } },
    }),
    prisma.fc_link.count({ where }),
  ]);

  const rows = rowsRaw.map((fcLink) => ({
    id: fcLink.id,
    name: fcLink.name,
    url: fcLink.url,
    creator_id: fcLink.creator_id,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return 'music';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return 'channel';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return String(((fcLink as any).fc_linkable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return String(((fcLink as any).fc_linkable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return String(((fcLink as any).fc_linkable)?.music.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return String(((fcLink as any).fc_linkable)?.channel.name ?? '');
      return null;
    })(),
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getFcLinkPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('fc_link');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'fc_link');
  }
  const pageData = await getFcLinkPage(opts, permissions, userId);
  return { fcLinkPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchFcLinkPage(opts: PageOpts): Promise<PageResult<FcLink>> {
  const { permissions, userId } = await getModelPermissions('fc_link');
  await assertPermission(permissions, 'read', 'fc_link');
  return getFcLinkPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchFcLinkOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<FcLink[]> {
  const { permissions, userId } = await getModelPermissions('fc_link');
  await assertPermission(permissions, 'read', 'fc_link');
  const accessAnd = buildFcLinkAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.fc_link.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
    include: { fc_linkable: { include: { work: { select: { id: true, title: true } }, character: { select: { id: true, name: true } }, music: { select: { id: true, title: true } }, channel: { select: { id: true, name: true } } } } },
  });
  return rowsRaw.map((fcLink) => ({
    id: fcLink.id,
    name: fcLink.name,
    url: fcLink.url,
    creator_id: fcLink.creator_id,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return 'music';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return 'channel';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.work) return String(((fcLink as any).fc_linkable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.character) return String(((fcLink as any).fc_linkable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.music) return String(((fcLink as any).fc_linkable)?.music.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((fcLink as any).fc_linkable)?.channel) return String(((fcLink as any).fc_linkable)?.channel.name ?? '');
      return null;
    })(),
  }));
}
