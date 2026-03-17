'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addShift, updateShift, deleteShift } from './service';
export async function upsertShift(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.shift.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('shift', 'update', existing);
  } else {
    await requirePermission('shift', 'create');
  }
  const userAccountId = data.get('user_account_id') as string;
  const startTimeStr = data.get('start_time') as string;
  const startTime = new Date(startTimeStr);
  const endTimeStr = data.get('end_time') as string;
  const endTime = new Date(endTimeStr);
  const status = Number(data.get('status'));
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateShift(userId, id, userAccountId, startTime, endTime, status, srcSnapshotRaw);
  } else {
    await addShift(userId, userAccountId, startTime, endTime, status);
  }

  redirect('/shift');
}
export async function removeShift(ids: string[]) {
  const [{ permissions: userPermissions, userId }, shifts] = await Promise.all([
    getModelPermissions('shift'),
    await prisma.shift.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredShifts = userPermissions.general.delete
    ? shifts
    : shifts.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredShifts.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteShift(filteredShifts.map(item => item.id));
  redirect('/shift');
}

