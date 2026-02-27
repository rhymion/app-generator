'use server';

import prisma from '@/lib/prisma';
import type { Shift, ShiftDetail } from '@/lib/shift/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

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
    user_account: shift.user_account,
  }));
}

export async function getShiftDetail(id: string): Promise<ShiftDetail | null> {
  
  const shift = await prisma.shift.findUnique({
    where: { 
      id,
    },
    include: { 
      user_account: true, 
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
    },
  });

  if (!shift) {
    return null;
  }

  return {
    ...shift,
    user_account: shift.user_account,
  };
}

export async function getShiftListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('shift');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift');
  }
  const shifts = await getAllShifts();
  return { shifts, userPermissions };
}

export async function getShiftDetailPageData(id: string, operation: Operation = 'read') {
  const shift = await getShiftDetail(id);
  const userPermissions = await getModelPermissions('shift', undefined, shift);
  await assertPermission(userPermissions, operation, 'shift');
  return { shift, userPermissions };
}

export async function getShiftNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('shift');
  await assertPermission(userPermissions, 'create', 'shift');
  return userPermissions;
}
