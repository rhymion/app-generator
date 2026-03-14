'use server';

import prisma from '@/lib/prisma';
import { assertPermission, getModelPermissions } from '@/lib/authz';

export type BookingForChart = {
  id: string;
  resource_id: string;
  resource_name: string;
  start_time: string;
  end_time: string;
  name: string;
};

export async function getBookingsForChart(startDate: Date, endDate: Date): Promise<BookingForChart[]> {
  const { permissions: userPermissions, userId } = await getModelPermissions('booking');
  await assertPermission(userPermissions, 'read', 'booking');

  const items = await prisma.booking.findMany({
    where: {
      start_time: { lt: endDate },
      end_time: { gt: startDate },
    },
    include: { resource: true },
    orderBy: [{ start_time: 'asc' }],
  });

  return items.map((item) => ({
    id: item.id,
    resource_id: item.resource_id,
    resource_name: (item.resource as { name: string }).name,
    start_time: (item.start_time as Date).toISOString(),
    end_time: (item.end_time as Date).toISOString(),
    name: item.name,
  }));
}
