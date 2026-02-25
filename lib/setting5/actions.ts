'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateSetting5 } from './service';

export async function upsertSetting5(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.user_account.findUnique({ where: { id }, select: { creator_id: true } });
  await requirePermission('setting5', 'update', existing);
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const userId = await getSessionUserIdOrThrow();

  await updateSetting5(userId, id, name, email, srcSnapshotRaw);

  revalidatePath('/');
  redirect('/setting5');
}
