'use server';

import prisma from '@/lib/prisma';
import type { DbTable, DbTableDetail } from '@/lib/db_table/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllDbTables(): Promise<DbTable[]> {
  const dbTables = await prisma.db_table.findMany({
  });
  return dbTables.map((dbTable) => ({
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
  }));
}

export async function getDbTableDetail(id: string): Promise<DbTableDetail | null> {
  const dbTable = await prisma.db_table.findUnique({
    where: {
      id,
    },
    include: {
      fields: { include: { reference: true } }, db_table_comments: { include: { creator: { select: { id: true, name: true, avatar: true } } }, orderBy: { created_at: 'asc' } }, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!dbTable) {
    return null;
  }

  return {
    ...dbTable,
    fields: dbTable.fields,
    db_table_comments: dbTable.db_table_comments,
  };
}

export async function getDbTableListPageData(isAssertPermission: boolean = true) {
  const [userPermissions, dbTables] = await Promise.all([
    getModelPermissions('db_table'),
    getAllDbTables(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'db_table');
  }
  return { dbTables, userPermissions };
}

export async function getDbTableDetailPageData(id: string, operation: Operation = 'read') {
  const dbTable = await getDbTableDetail(id);
  const userPermissions = await getModelPermissions('db_table', undefined, dbTable);
  await assertPermission(userPermissions, operation, 'db_table');
  return { dbTable, userPermissions };
}

export async function getDbTableNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('db_table');
  await assertPermission(userPermissions, 'create', 'db_table');
  return userPermissions;
}
