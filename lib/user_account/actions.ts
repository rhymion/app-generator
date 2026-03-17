'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateUserAccount, deleteUserAccount } from './service';
export async function upsertUserAccount(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.user_account.findUnique({ where: { id }, select: { id: true, creator_id: true } });
  await requirePermission('user_account', 'update', existing);
  const name = data.get('name') as string;
  const avatar = data.get('avatar') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const rolesItems = rolesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const rolesIds = rolesItems
    .map((role) => role.id)
    .filter((roleId): roleId is string => Boolean(roleId));

  const userId = await getSessionUserIdOrThrow();
  await updateUserAccount(userId, id, name, avatar, rolesIds, srcSnapshotRaw);

  redirect('/user_account');
}
export async function removeUserAccount(ids: string[]) {
  const [{ permissions: userPermissions, userId }, userAccounts] = await Promise.all([
    getModelPermissions('user_account'),
    await prisma.user_account.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredUserAccounts = userPermissions.general.delete
    ? userAccounts
    : userAccounts.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredUserAccounts.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteUserAccount(filteredUserAccounts.map(item => item.id));
  redirect('/user_account');
}

