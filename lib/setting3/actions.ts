'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateSetting3, deleteSetting3 } from './service';
export async function upsertSetting3(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { creator_id: true } });
  await requirePermission('setting3', 'update', existing);
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;

  const userId = await getSessionUserIdOrThrow();
  await updateSetting3(userId, id, name, description, srcSnapshotRaw);

  revalidatePath('/');
  redirect('/setting3');
}
export async function removeSetting3(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('setting3', 'delete', item);
  }
  await deleteSetting3(ids);
  revalidatePath('/');
  redirect('/setting3');
}

