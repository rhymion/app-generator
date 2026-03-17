'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addBooking, updateBooking, deleteBooking } from './service';
export async function upsertBooking(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.booking.findUnique({ where: { id }, select: { id: true, creator_id: true } });
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

  redirect('/booking');
}
export async function removeBooking(ids: string[]) {
  const [{ permissions: userPermissions, userId }, bookings] = await Promise.all([
    getModelPermissions('booking'),
    await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredBookings = userPermissions.general.delete
    ? bookings
    : bookings.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredBookings.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteBooking(filteredBookings.map(item => item.id));
  redirect('/booking');
}

