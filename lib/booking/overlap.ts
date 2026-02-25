'use server';

import prisma from '@/lib/prisma';

type TransactionClient = Pick<typeof prisma, 'booking'>;

async function hasOverlap(
  client: TransactionClient,
  resourceId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string | null,
): Promise<boolean> {
  const excludeFilter = excludeId ? { id: { not: excludeId } } : {};

  // Step 1: Get the latest booking for this resource that started before this booking's start time
  const prevBooking = await client.booking.findFirst({
    where: { resource_id: resourceId, start_time: { lt: startTime }, ...excludeFilter },
    orderBy: { start_time: 'desc' },
    select: { end_time: true },
  });
  // Step 2: If its end_time is after this booking's start_time, there's an overlap
  if (prevBooking && prevBooking.end_time > startTime) {
    return true;
  }

  // Step 3: Get the earliest booking for this resource that starts at or after this booking's start time
  const nextBooking = await client.booking.findFirst({
    where: { resource_id: resourceId, start_time: { gte: startTime }, ...excludeFilter },
    orderBy: { start_time: 'asc' },
    select: { start_time: true },
  });
  // Step 4: If it starts before this booking's end_time, there's an overlap
  if (nextBooking && nextBooking.start_time < endTime) {
    return true;
  }

  return false;
}

// Server action: called from FormUpsert client component to validate before submit
export async function checkBookingOverlap(
  resourceId: string,
  startTimeStr: string,
  endTimeStr: string,
  excludeId?: string | null,
): Promise<boolean> {
  if (!resourceId || !startTimeStr || !endTimeStr) return false;
  return hasOverlap(prisma, resourceId, new Date(startTimeStr), new Date(endTimeStr), excludeId);
}

// Called inside Prisma transactions in service.ts as a safety net
export async function assertNoBookingOverlap(
  tx: TransactionClient,
  resourceId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string | null,
): Promise<void> {
  if (await hasOverlap(tx, resourceId, startTime, endTime, excludeId)) {
    throw new Error('Booking time overlaps with an existing booking for this resource');
  }
}
