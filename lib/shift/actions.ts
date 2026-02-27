'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addShift, updateShift, deleteShift } from './service';

export async function upsertShift(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.shift.findUnique({ where: { id }, select: { creator_id: true } });
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

  revalidatePath('/');
  redirect('/shift');
}

export async function removeShift(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.shift.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('shift', 'delete', item);
  }
  await deleteShift(ids);
  revalidatePath('/');
  redirect('/shift');
}
