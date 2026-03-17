'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addShiftTemplate, updateShiftTemplate, deleteShiftTemplate } from './service';
export async function upsertShiftTemplate(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.shift_template.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('shift_template', 'update', existing);
  } else {
    await requirePermission('shift_template', 'create');
  }
  const userAccountId = data.get('user_account_id') as string;
  const dayOfWeek = Number(data.get('day_of_week'));
  const startTimeStr = data.get('start_time') as string;
  const startTime = new Date(startTimeStr);
  const endTimeStr = data.get('end_time') as string;
  const endTime = new Date(endTimeStr);
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateShiftTemplate(userId, id, userAccountId, dayOfWeek, startTime, endTime, srcSnapshotRaw);
  } else {
    await addShiftTemplate(userId, userAccountId, dayOfWeek, startTime, endTime);
  }

  redirect('/shift_template');
}
export async function removeShiftTemplate(ids: string[]) {
  const [{ permissions: userPermissions, userId }, shiftTemplates] = await Promise.all([
    getModelPermissions('shift_template'),
    await prisma.shift_template.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredShiftTemplates = userPermissions.general.delete
    ? shiftTemplates
    : shiftTemplates.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredShiftTemplates.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteShiftTemplate(filteredShiftTemplates.map(item => item.id));
  redirect('/shift_template');
}

