'use server';

import prisma from '@/lib/prisma';
import type { DbTable, DbTableDetail } from '@/lib/db_table/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation, RichPermissions } from '@/lib/authz';
import {
  type PageOpts, type PageResult,
  DEFAULT_PAGE_SIZE, clampPage, buildOrderBy, buildFilter,
} from '@/lib/_pagination';

// Allow-lists for sort/filter — anything not in here is silently dropped at
// request time so external input cannot pick arbitrary columns.
const SORTABLE_FIELDS = new Set<string>(['id', 'name', 'description', 'commentable_id', 'created_at', 'updated_at', 'creator_id']);
const FILTERABLE_FIELDS = new Set<string>(['id', 'name', 'description', 'commentable_id', 'created_at', 'updated_at', 'creator_id']);

/** Build the where clauses that enforce read scope (org + Creator/Assignee). */
function buildDbTableAccessWhere(
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

export async function getDbTableDetail(id: string): Promise<DbTableDetail | null> {
  const dbTable = await prisma.db_table.findUnique({
    where: {
      id,
    },
    include: {
      fields: { include: { reference: true } }, commentable: { include: { comments: { include: { creator: { select: { id: true, name: true, image: true } }, reactions: { select: { type: true, user_id: true } } }, orderBy: { created_at: 'asc' } } } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!dbTable) {
    return null;
  }

  const _commentable = dbTable.commentable ? {
    ...dbTable.commentable,
    comments: dbTable.commentable.comments.map((c) => {
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
  } : dbTable.commentable;
  return {
    ...dbTable,
    commentable: _commentable,
  };
}

export async function getDbTableDetailPageData(id: string, operation: Operation = 'read') {
  const [dbTable, { permissions: basePermissions, userId }] = await Promise.all([
    getDbTableDetail(id),
    getModelPermissions('db_table'),
  ]);
  const resolved = await resolvePermissions(basePermissions, dbTable, userId ?? '');
  await assertPermission(resolved, operation, 'db_table');
  return { dbTable, userPermissions: await toPermissions(resolved) };
}

export async function getDbTableNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('db_table');
  await assertPermission(richPermissions.general, 'create', 'db_table');
  return richPermissions.general;
}

/**
 * Paginated query for db_table — pushes Creator/Assignee/org filters into the
 * where clause so the DB never has to scan the full table for restricted users.
 * `perms` and `userId` must already be loaded by the caller (so server actions
 * and route handlers can reuse the permission lookup they already did).
 */
export async function getDbTablePage(
  opts: PageOpts,
  perms: RichPermissions,
  userId: string | null,
): Promise<PageResult<DbTable>> {
  const { page, pageSize, skip, take } = clampPage(opts);
  const accessAnd = buildDbTableAccessWhere(perms, userId);
  const filterAnd = buildFilter(opts.filter, FILTERABLE_FIELDS);
  const where = { AND: [...accessAnd, ...filterAnd] };
  const orderBy = buildOrderBy(opts.sort, SORTABLE_FIELDS);

  const [rowsRaw, total] = await prisma.$transaction([
    prisma.db_table.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    prisma.db_table.count({ where }),
  ]);

  const rows = rowsRaw.map((dbTable) => ({
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
    commentable_id: dbTable.commentable_id,
    creator_id: dbTable.creator_id,
  }));
  return { rows, total, page, pageSize };
}

/**
 * Server-component entry point for the paginated list page. Asserts read
 * permission and returns the requested page + the user's effective permissions.
 */
export async function getDbTablePagedData(
  opts: PageOpts = { page: 0, pageSize: DEFAULT_PAGE_SIZE },
  isAssertPermission: boolean = true,
) {
  const { permissions, userId } = await getModelPermissions('db_table');
  if (isAssertPermission) {
    await assertPermission(permissions, 'read', 'db_table');
  }
  const pageData = await getDbTablePage(opts, permissions, userId);
  return { dbTablePage: pageData, userPermissions: await toPermissions(permissions) };
}

/** Server Action used by the DataGrid client for subsequent pages / sort / filter. */
export async function fetchDbTablePage(opts: PageOpts): Promise<PageResult<DbTable>> {
  const { permissions, userId } = await getModelPermissions('db_table');
  await assertPermission(permissions, 'read', 'db_table');
  return getDbTablePage(opts, permissions, userId);
}

/**
 * Lightweight search for autocomplete pickers. Returns up to `limit` rows
 * matching `query` (substring on name) plus any rows in `includeIds` so the
 * currently-selected option is always present even when it doesn't match the
 * query. Applies the same access scope as the list page.
 */
export async function searchDbTableOptions(
  query: string,
  includeIds: string[] = [],
  limit: number = 50,
): Promise<DbTable[]> {
  const { permissions, userId } = await getModelPermissions('db_table');
  await assertPermission(permissions, 'read', 'db_table');
  const accessAnd = buildDbTableAccessWhere(permissions, userId);

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
  const rowsRaw = await prisma.db_table.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: safeLimit + includeIds.length,
  });
  return rowsRaw.map((dbTable) => ({
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
    commentable_id: dbTable.commentable_id,
    creator_id: dbTable.creator_id,
  }));
}
