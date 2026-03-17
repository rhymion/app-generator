'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateSetting3, deleteSetting3 } from './service';
export async function upsertSetting3(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { id: true, creator_id: true } });
  await requirePermission('setting3', 'update', existing);
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;

  const userId = await getSessionUserIdOrThrow();
  await updateSetting3(userId, id, name, description, srcSnapshotRaw);

  redirect('/setting3');
}
export async function removeSetting3(ids: string[]) {
  const [{ permissions: userPermissions, userId }, setting3s] = await Promise.all([
    getModelPermissions('setting3'),
    await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredSetting3s = userPermissions.general.delete
    ? setting3s
    : setting3s.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredSetting3s.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteSetting3(filteredSetting3s.map(item => item.id));
  redirect('/setting3');
}

