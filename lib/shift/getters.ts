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
      user_account: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
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
  const t0 = performance.now();
  const [userPermissions, shifts] = await Promise.all([
    getModelPermissions('shift'),
    getAllShifts(),
  ]);
  console.log(`getModelPermissions: ${(performance.now() - t0).toFixed(1)}ms`);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift');
  }
  console.log(`getShiftListPageData: ${(performance.now() - t0).toFixed(1)}ms`);
  return { shifts, userPermissions };
}

export async function getShiftDetailPageData(id: string, operation: Operation = 'read') {
  const t0 = performance.now();
  const shift = await getShiftDetail(id);
  console.log(`getShiftDetail: ${(performance.now() - t0).toFixed(1)}ms`);
  const userPermissions = await getModelPermissions('shift', undefined, shift);
  console.log(`getModelPermissions: ${(performance.now() - t0).toFixed(1)}ms`);
  await assertPermission(userPermissions, operation, 'shift');
  console.log(`getShiftDetailPageData: ${(performance.now() - t0).toFixed(1)}ms`);
  return { shift, userPermissions };
}

export async function getShiftNewPageAccessCheck() {
  const t0 = performance.now();
  const userPermissions = await getModelPermissions('shift');
  console.log(`getModelPermissions: ${(performance.now() - t0).toFixed(1)}ms`);
  await assertPermission(userPermissions, 'create', 'shift');
  console.log(`getShiftNewPageAccessCheck: ${(performance.now() - t0).toFixed(1)}ms`);
  return userPermissions;
}
