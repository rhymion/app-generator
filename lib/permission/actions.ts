'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addPermission, updatePermission, deletePermission } from './service';

export async function upsertPermission(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('permission', 'update');
  } else {
    await requirePermission('permission', 'create');
  }
  const name = data.get('name') as string;
  const create = data.get('create') === 'true';
  const read = data.get('read') === 'true';
  const update = data.get('update') === 'true';
  const deleteValue = data.get('delete') === 'true';
  const roleId = (data.get('role_id') as string | null) || null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updatePermission(userId, id, name, create, read, update, deleteValue, roleId, srcSnapshotRaw);
  } else {
    await addPermission(userId, name, create, read, update, deleteValue, roleId);
  }

  revalidatePath('/');
  redirect('/permission');
}

export async function removePermission(data: FormData | string[]) {
  await requirePermission('permission', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deletePermission(ids);
  revalidatePath('/');
  redirect('/permission');
}
