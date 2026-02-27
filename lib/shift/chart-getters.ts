'use server';

import prisma from '@/lib/prisma';
import { assertPermission, getModelPermissions } from '@/lib/authz';

export type ShiftForChart = {
  id: string;
  user_account_id: string;
  user_account_name: string;
  start_time: string; // ISO string
  end_time: string;   // ISO string
  status: number;
};

export async function getShiftsForChart(startDate: Date, endDate: Date): Promise<ShiftForChart[]> {
  const userPermissions = await getModelPermissions('shift');
  await assertPermission(userPermissions, 'read', 'shift');

  const shifts = await prisma.shift.findMany({
    where: {
      start_time: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: { user_account: true },
    orderBy: [{ start_time: 'asc' }],
  });

  return shifts.map((shift) => ({
    id: shift.id,
    user_account_id: shift.user_account_id,
    user_account_name: shift.user_account.name,
    start_time: shift.start_time.toISOString(),
    end_time: shift.end_time.toISOString(),
    status: shift.status,
  }));
}
