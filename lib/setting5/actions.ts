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
  const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { creator_id: true } });
  await requirePermission('setting5', 'update', existing);
  const name = data.get('name') as string;
  const yyyyyYyyyysRaw = data.getAll('yyyyy_yyyyy[]') as string[];
  const yyyyyYyyyysItems = yyyyyYyyyysRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });

  const userId = await getSessionUserIdOrThrow();
  await updateSetting5(userId, id, name, yyyyyYyyyysItems, srcSnapshotRaw);

  revalidatePath('/');
  redirect('/setting5');
}
