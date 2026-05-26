'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
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
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updatePermission(actorId, id, name, create, read, update, deleteValue, roleId, srcSnapshotRaw);
  } else {
    await addPermission(actorId, name, create, read, update, deleteValue, roleId);
  }

  redirect('/permission');
}
export async function removePermission(ids: string[]) {
  const [{ permissions: userPermissions, userId }, permissions] = await Promise.all([
    getModelPermissions('permission'),
    await prisma.permission.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredPermissions = userPermissions.general.delete
    ? permissions
    : permissions.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredPermissions.length === 0) {
    throw new Error('No permission to delete');
  }
  await deletePermission(userId, filteredPermissions.map(item => item.id));
  revalidatePath('/[locale]/permission', 'page');
  redirect('/permission');
}

