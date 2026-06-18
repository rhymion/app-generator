'use server';

import prisma from '@/lib/prisma';
import type { Channel, ChannelDetail } from '@/lib/channel/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions, getSessionUserIdOrThrow } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'kind', 'organization_id', 'commentable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id', 'channelable_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'kind', 'organization_id', 'commentable_id', 'fc_linkable_id', 'created_at', 'updated_at', 'creator_id', 'channelable_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildChannelAccessWhere(
  perms: RichPermissions,
  userId: string | null,
  associatedOrganizationIds: string[],
): Record<string, unknown>[] {
  const and: Record<string, unknown>[] = [];
  and.push({ organization_id: { in: associatedOrganizationIds } });
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

export async function getChannelDetail(id: string, userId: string): Promise<ChannelDetail | null> {
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const channel = await prisma.channel.findFirst({
    where: {
      id,
      organization_id: { in: associatedOrganizationIds },
    },
    include: {
      organization: true, commentable: { include: { comments: { include: { creator: { select: { id: true, name: true, image: true } }, reactions: { select: { type: true, user_id: true } } }, orderBy: { created_at: 'asc' } } } }, fc_linkable: true, channelable: { include: { work: { select: { id: true, title: true } }, character: { select: { id: true, name: true } }, scene: { select: { id: true, label: true } } } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!channel) {
    return null;
  }

  const _commentable = channel.commentable ? {
    ...channel.commentable,
    comments: channel.commentable.comments.map((c) => {
      const { reactions, ...rest } = c;
      const reactionCounts = reactions.reduce<Array<{ type: number; count: number }>>(
        (acc, r) => {
          const entry = acc.find((e) => e.type === r.type);
          if (entry) entry.count += 1;
          else acc.push({ type: r.type, count: 1 });
          return acc;
        },
        [],
      );
      return { ...rest, reactionCounts, myReactionTypes: [] as number[] };
    }),
  } : channel.commentable;
  return {
    ...channel,
    commentable: _commentable,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return 'scene';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return String(((channel as any).channelable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return String(((channel as any).channelable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return String(((channel as any).channelable)?.scene.label ?? '');
      return null;
    })(),
  };
}

export async function getChannelDetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const [channel, { permissions: basePermissions }] = await Promise.all([
    getChannelDetail(id, userId),
    getModelPermissions('channel', userId),
  ]);
  const resolved = await resolvePermissions(basePermissions, channel, userId ?? '');
  await assertPermission(resolved, operation, 'channel');
  return { channel, userPermissions: await toPermissions(resolved) };
}

export async function getChannelNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('channel');
  await assertPermission(richPermissions.general, 'create', 'channel');
  return richPermissions.general;
}

/**
 * Paginated query for channel — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getChannelPage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<Channel>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const associatedOrganizations = userId ? await getAssociatedOrganizations(userId) : [];
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const accessAnd = buildChannelAccessWhere(perms, userId, associatedOrganizationIds);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.channel.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { organization: true, channelable: { include: { work: { select: { id: true, title: true } }, character: { select: { id: true, name: true } }, scene: { select: { id: true, label: true } } } } },
    }),
    prisma.channel.count({ where }),
  ]);

  const rows = rowsRaw.map((channel) => ({
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    organization_id: channel.organization_id,
    commentable_id: channel.commentable_id,
    fc_linkable_id: channel.fc_linkable_id,
    creator_id: channel.creator_id,
    organization: channel.organization,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return 'scene';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return String(((channel as any).channelable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return String(((channel as any).channelable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return String(((channel as any).channelable)?.scene.label ?? '');
      return null;
    })(),
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getChannelPagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('channel', userId);
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'channel');
  }
  const pageData = await getChannelPage(opts, permissions, userId);
  return { channelPage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchChannelPage(opts: PageOpts): Promise<PageResult<Channel>> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('channel', userId);
  await assertPermission(permissions, 'read', 'channel');
  return getChannelPage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchChannelOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<Channel[]> {
  const userId = await getSessionUserIdOrThrow();
  const { permissions } = await getModelPermissions('channel', userId);
  await assertPermission(permissions, 'read', 'channel');
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const accessAnd = buildChannelAccessWhere(permissions, userId, associatedOrganizationIds);

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
  const rowsRaw = await prisma.channel.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
    include: { organization: true },
  });
  return rowsRaw.map((channel) => ({
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    organization_id: channel.organization_id,
    commentable_id: channel.commentable_id,
    fc_linkable_id: channel.fc_linkable_id,
    creator_id: channel.creator_id,
    organization: channel.organization,
    parent_type: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return 'work';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return 'character';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return 'scene';
      return null;
    })(),
    parent_label: (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.work) return String(((channel as any).channelable)?.work.title ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.character) return String(((channel as any).channelable)?.character.name ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((channel as any).channelable)?.scene) return String(((channel as any).channelable)?.scene.label ?? '');
      return null;
    })(),
  }));
}
