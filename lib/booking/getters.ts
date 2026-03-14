'use server';

import prisma from '@/lib/prisma';
import type { Booking, BookingDetail } from '@/lib/booking/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllBookings(): Promise<Booking[]> {
  const bookings = await prisma.booking.findMany({
    include: { resource: true },
  });
  return bookings.map((booking) => ({
    id: booking.id,
    name: booking.name,
    resource_id: booking.resource_id,
    start_time: booking.start_time,
    end_time: booking.end_time,
    creator_id: booking.creator_id,
    resource: booking.resource,
  }));
}

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const booking = await prisma.booking.findUnique({
    where: {
      id,
    },
    include: {
      resource: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!booking) {
    return null;
  }

  return {
    ...booking,
    resource: booking.resource,
  };
}

export async function getBookingListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, bookings] = await Promise.all([
    getModelPermissions('booking'),
    getAllBookings(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'booking');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredBookings = userPermissions.general.read
    ? bookings
    : bookings.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { bookings: filteredBookings, userPermissions: await toPermissions(userPermissions) };
}

export async function getBookingDetailPageData(id: string, operation: Operation = 'read') {
  const [booking, { permissions: basePermissions, userId }] = await Promise.all([
    getBookingDetail(id),
    getModelPermissions('booking'),
  ]);
  const resolved = await resolvePermissions(basePermissions, booking, userId ?? '');
  await assertPermission(resolved, operation, 'booking');
  return { booking, userPermissions: await toPermissions(resolved) };
}

export async function getBookingNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('booking');
  await assertPermission(richPermissions.general, 'create', 'booking');
  return richPermissions.general;
}
