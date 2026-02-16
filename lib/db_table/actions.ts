'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addDbTable, updateDbTable, deleteDbTable } from './service';

export async function upsertDbTable(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.db_table.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('db_table', 'update', existing);
  } else {
    await requirePermission('db_table', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const fieldsRaw = data.getAll('field[]') as string[];
  const fieldsItems = fieldsRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateDbTable(userId, id, name, description, fieldsItems, srcSnapshotRaw);
  } else {
    await addDbTable(userId, name, description, fieldsItems);
  }

  revalidatePath('/');
  redirect('/db_table');
}

export async function removeDbTable(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.db_table.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('db_table', 'delete', item);
  }
  await deleteDbTable(ids);
  revalidatePath('/');
  redirect('/db_table');
}
