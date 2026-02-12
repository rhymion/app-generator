'use server';

import prisma from '@/lib/prisma';
import type { Booking, BookingDetail } from '@/lib/booking/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

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
    resource: booking.resource,
  }));
}

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  
  const booking = await prisma.booking.findUnique({
    where: { 
      id,
    },
    include: { 
      resource: true 
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
  const userPermissions = await getModelPermissions('booking');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'booking');
  }
  const bookings = await getAllBookings();
  return { bookings, userPermissions };
}

export async function getBookingDetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('booking');
  await assertPermission(userPermissions, operation, 'booking');
  const booking = await getBookingDetail(id);
  return { booking, userPermissions };
}

export async function getBookingNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('booking');
  await assertPermission(userPermissions, 'create', 'booking');
  return userPermissions;
}
