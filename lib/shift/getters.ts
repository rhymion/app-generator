'use server';

import prisma from '@/lib/prisma';
import type { Shift, ShiftDetail } from '@/lib/shift/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllShifts(): Promise<Shift[]> {
  const shifts = await prisma.shift.findMany({
    include: { user_account: true },
  });
  return shifts.map((shift) => ({
    id: shift.id,
    user_account_id: shift.user_account_id,
    start_time: shift.start_time,
    end_time: shift.end_time,
    status: shift.status,
    creator_id: shift.creator_id,
    user_account: shift.user_account,
  }));
}

export async function getShiftDetail(id: string): Promise<ShiftDetail | null> {
  const shift = await prisma.shift.findUnique({
    where: {
      id,
    },
    include: {
      user_account: true
    },
  });

  if (!shift) {
    return null;
  }

  return {
    ...shift,
  };
}

export async function getShiftListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, shifts] = await Promise.all([
    getModelPermissions('shift'),
    getAllShifts(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredShifts = userPermissions.general.read
    ? shifts
    : shifts.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { shifts: filteredShifts, userPermissions: await toPermissions(userPermissions) };
}

export async function getShiftDetailPageData(id: string, operation: Operation = 'read') {
  const [shift, { permissions: basePermissions, userId }] = await Promise.all([
    getShiftDetail(id),
    getModelPermissions('shift'),
  ]);
  const resolved = await resolvePermissions(basePermissions, shift, userId ?? '');
  await assertPermission(resolved, operation, 'shift');
  return { shift, userPermissions: await toPermissions(resolved) };
}

export async function getShiftNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('shift');
  await assertPermission(richPermissions.general, 'create', 'shift');
  return richPermissions.general;
}
