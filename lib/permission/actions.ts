'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addPermission, updatePermission, deletePermission } from './service';
export async function upsertPermission(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.permission.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('permission', 'update', existing);
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

  redirect('/permission');
}
export async function removePermission(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.permission.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('permission', 'delete', item);
  }
  await deletePermission(ids);
  redirect('/permission');
}

