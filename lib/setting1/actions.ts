'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting1, updateSetting1, deleteSetting1 } from './service';
export async function upsertSetting1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('setting1', 'update', existing);
  } else {
    await requirePermission('setting1', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const team = data.get('team') as string | null;
  const yyyyyYyyyysRaw = data.getAll('yyyyy_yyyyy[]') as string[];
  const yyyyyYyyyysItems = yyyyyYyyyysRaw.map(f => JSON.parse(f) as { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateSetting1(userId, id, name, description, team, yyyyyYyyyysItems, srcSnapshotRaw);
  } else {
    await addSetting1(userId, name, description, team, yyyyyYyyyysItems);
  }

  redirect('/setting1');
}
export async function removeSetting1(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('setting1', 'delete', item);
  }
  await deleteSetting1(ids);
  redirect('/setting1');
}

