'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateUser, deleteUser } from './service';
export async function upsertUser(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, creator_id: true } });
  await requirePermission('user', 'update', existing);
  const name = data.get('name') as string;
  const image = data.get('image') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const rolesItems = rolesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const rolesIds = rolesItems
    .map((role) => role.id)
    .filter((roleId): roleId is string => Boolean(roleId));
  const subAccountsRaw = data.getAll('sub_account[]') as string[];
  const subAccountsItems = subAccountsRaw.map(f => JSON.parse(f) as { id?: string; nickname: string });

  const actorId = await getSessionUserIdOrThrow();
  await updateUser(actorId, id, name, image, rolesIds, subAccountsItems, srcSnapshotRaw);

  redirect('/user');
}
export async function removeUser(ids: string[]) {
  const [{ permissions: userPermissions, userId }, users] = await Promise.all([
    getModelPermissions('user'),
    await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredUsers = userPermissions.general.delete
    ? users
    : users.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredUsers.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteUser(filteredUsers.map(item => item.id));
  revalidatePath('/[locale]/user', 'page');
  redirect('/user');
}

