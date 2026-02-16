'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addBooking, updateBooking, deleteBooking } from './service';

export async function upsertBooking(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.booking.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('booking', 'update', existing);
  } else {
    await requirePermission('booking', 'create');
  }
  const name = data.get('name') as string;
  const resourceId = data.get('resource_id') as string;
  const startTimeStr = data.get('start_time') as string;
  const startTime = new Date(startTimeStr);
  const endTimeStr = data.get('end_time') as string;
  const endTime = new Date(endTimeStr);
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateBooking(userId, id, name, resourceId, startTime, endTime, srcSnapshotRaw);
  } else {
    await addBooking(userId, name, resourceId, startTime, endTime);
  }

  revalidatePath('/');
  redirect('/booking');
}

export async function removeBooking(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('booking', 'delete', item);
  }
  await deleteBooking(ids);
  revalidatePath('/');
  redirect('/booking');
}
