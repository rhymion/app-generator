'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { deleteSetting6 } from './service';
export async function removeSetting6(ids: string[]) {
  const [{ permissions: userPermissions, userId }, setting6s] = await Promise.all([
    getModelPermissions('setting6'),
    await prisma.xxxxx_xxxxx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredSetting6s = userPermissions.general.delete
    ? setting6s
    : setting6s.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredSetting6s.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteSetting6(filteredSetting6s.map(item => item.id));
  redirect('/setting6');
}

