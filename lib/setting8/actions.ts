'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
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
export async function removeSetting8(ids: string[]) {
  const [{ permissions: userPermissions, userId }, setting8s] = await Promise.all([
    getModelPermissions('setting8'),
    await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredSetting8s = userPermissions.general.delete
    ? setting8s
    : setting8s.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredSetting8s.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteSetting8(filteredSetting8s.map(item => item.id));
  redirect('/setting8');
}

