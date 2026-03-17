'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting1, updateSetting1, deleteSetting1 } from './service';
export async function upsertSetting1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { id: true, creator_id: true } });
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
export async function removeSetting1(ids: string[]) {
  const [{ permissions: userPermissions, userId }, setting1s] = await Promise.all([
    getModelPermissions('setting1'),
    await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredSetting1s = userPermissions.general.delete
    ? setting1s
    : setting1s.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredSetting1s.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteSetting1(filteredSetting1s.map(item => item.id));
  redirect('/setting1');
}

