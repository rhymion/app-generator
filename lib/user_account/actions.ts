'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
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
export async function removeUserAccount(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.user_account.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('user_account', 'delete', item);
  }
  await deleteUserAccount(ids);
  redirect('/user_account');
}

