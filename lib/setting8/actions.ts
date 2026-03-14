'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting8, deleteSetting8 } from './service';
export async function upsertSetting8(data: FormData) {
  await requirePermission('setting8', 'create');
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;

  const userId = await getSessionUserIdOrThrow();
  await addSetting8(userId, name, description);

  redirect('/setting8');
}
export async function removeSetting8(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('setting8', 'delete', item);
  }
  await deleteSetting8(ids);
  redirect('/setting8');
}

