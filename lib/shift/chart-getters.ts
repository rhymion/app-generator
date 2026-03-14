'use server';

import prisma from '@/lib/prisma';
import { assertPermission, getModelPermissions } from '@/lib/authz';

export type ShiftForChart = {
  id: string;
  user_account_id: string;
  user_account_name: string;
  start_time: string;
  end_time: string;
  status: number;
};

export async function getShiftsForChart(startDate: Date, endDate: Date): Promise<ShiftForChart[]> {
  const { permissions: userPermissions, userId } = await getModelPermissions('shift');
  await assertPermission(userPermissions, 'read', 'shift');

  const items = await prisma.shift.findMany({
    where: {
      start_time: { lt: endDate },
      end_time: { gt: startDate },
    },
    include: { user_account: true },
    orderBy: [{ start_time: 'asc' }],
  });

  return items.map((item) => ({
    id: item.id,
    user_account_id: item.user_account_id,
    user_account_name: (item.user_account as { name: string }).name,
    start_time: (item.start_time as Date).toISOString(),
    end_time: (item.end_time as Date).toISOString(),
    status: item.status,
  }));
}
