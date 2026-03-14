'use server';

import prisma from '@/lib/prisma';
import type { DbTable, DbTableDetail } from '@/lib/db_table/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllDbTables(): Promise<DbTable[]> {
  const dbTables = await prisma.db_table.findMany({
  });
  return dbTables.map((dbTable) => ({
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
    creator_id: dbTable.creator_id,
  }));
}

export async function getDbTableDetail(id: string): Promise<DbTableDetail | null> {
  const dbTable = await prisma.db_table.findUnique({
    where: {
      id,
    },
    include: {
      fields: { include: { reference: true } }, db_table_comments: { include: { creator: { select: { id: true, name: true, avatar: true } } }, orderBy: { created_at: 'asc' } }
    },
  });

  if (!dbTable) {
    return null;
  }

  return {
    ...dbTable,
  };
}

export async function getDbTableListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, dbTables] = await Promise.all([
    getModelPermissions('db_table'),
    getAllDbTables(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'db_table');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredDbTables = userPermissions.general.read
    ? dbTables
    : dbTables.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { dbTables: filteredDbTables, userPermissions: await toPermissions(userPermissions) };
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
