'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addRole, updateRole, deleteRole } from './service';
export async function upsertRole(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.role.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('role', 'update', existing);
  } else {
    await requirePermission('role', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const usersRaw = data.getAll('user[]') as string[];
  const usersItems = usersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const usersIds = usersItems
    .map((user) => user.id)
    .filter((userId): userId is string => Boolean(userId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateRole(actorId, id, name, description, usersIds, srcSnapshotRaw);
  } else {
    await addRole(actorId, name, description, usersIds);
  }

  redirect('/role');
}
export async function removeRole(ids: string[]) {
  const [{ permissions: userPermissions, userId }, roles] = await Promise.all([
    getModelPermissions('role'),
    await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredRoles = userPermissions.general.delete
    ? roles
    : roles.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredRoles.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteRole(userId, filteredRoles.map(item => item.id));
  revalidatePath('/[locale]/role', 'page');
  redirect('/role');
}

