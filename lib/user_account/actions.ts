'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addUserAccount, updateUserAccount, deleteUserAccount } from './service';

export async function upsertUserAccount(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.user_account.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('user_account', 'update', existing);
  } else {
    await requirePermission('user_account', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const rolesItems = rolesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const rolesIds = rolesItems
    .map((role) => role.id)
    .filter((roleId): roleId is string => Boolean(roleId));
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateUserAccount(userId, id, name, email, password, apiKey, avatar, rolesIds, srcSnapshotRaw);
  } else {
    await addUserAccount(userId, name, email, password, apiKey, avatar, rolesIds);
  }

  revalidatePath('/');
  redirect('/user_account');
}

export async function removeUserAccount(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.user_account.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('user_account', 'delete', item);
  }
  await deleteUserAccount(ids);
  revalidatePath('/');
  redirect('/user_account');
}
