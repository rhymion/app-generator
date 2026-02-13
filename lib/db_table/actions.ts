'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addDbTable, updateDbTable, deleteDbTable } from './service';

export async function upsertDbTable(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('db_table', 'update');
  } else {
    await requirePermission('db_table', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const fieldsRaw = data.getAll('field[]') as string[];
  const fieldsItems = fieldsRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean });

  if (id) {
    await updateDbTable(id, name, description, fieldsItems, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addDbTable(creatorId, name, description, fieldsItems);
  }

  revalidatePath('/');
  redirect('/db_table');
}

export async function removeDbTable(data: FormData | string[]) {
  await requirePermission('db_table', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteDbTable(ids);
  revalidatePath('/');
  redirect('/db_table');
}
