'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting1, updateSetting1, deleteSetting1 } from './service';

export async function upsertSetting1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.user_account.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('setting1', 'update', existing);
  } else {
    await requirePermission('setting1', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateSetting1(userId, id, name, email, password, apiKey, avatar, srcSnapshotRaw);
  } else {
    await addSetting1(userId, name, email, password, apiKey, avatar);
  }

  revalidatePath('/');
  redirect('/setting1');
}

export async function removeSetting1(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.user_account.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('setting1', 'delete', item);
  }
  await deleteSetting1(ids);
  revalidatePath('/');
  redirect('/setting1');
}
