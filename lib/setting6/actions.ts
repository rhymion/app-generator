'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { deleteSetting6 } from './service';
export async function removeSetting6(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('setting6', 'delete', item);
  }
  await deleteSetting6(ids);
  revalidatePath('/setting6');
  redirect('/setting6');
}

