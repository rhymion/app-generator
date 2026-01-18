'use server';

import prisma from '@/lib/prisma';
import type { DbTable, DbTableDetail, Field } from '@/lib/db_table/types';

export async function getAllDbTables(): Promise<DbTable[]> {
  const dbTables = await prisma.db_table.findMany();
  return dbTables.map((dbTable) => ({
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
  }));
}

export async function getDbTableDetail(id: string): Promise<DbTableDetail | null> {
  const dbTable = await prisma.db_table.findUnique({
    where: { id },
    include: { fields: true },
  });

  if (!dbTable) {
    return null;
  }

  return {
    id: dbTable.id,
    name: dbTable.name,
    description: dbTable.description,
    fields: dbTable.fields.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      table_id: field.table_id,
      max_length: field.max_length,
      max: field.max,
      regex: field.regex,
      required: field.required,
    })),
  };
}
