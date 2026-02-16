'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting7, updateSetting7 } from './service';

export async function upsertSetting7(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.user_account.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('setting7', 'update', existing);
  } else {
    await requirePermission('setting7', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateSetting7(userId, id, name, email, password, apiKey, avatar, srcSnapshotRaw);
  } else {
    await addSetting7(userId, name, email, password, apiKey, avatar);
  }

  revalidatePath('/');
  redirect('/setting7');
}
