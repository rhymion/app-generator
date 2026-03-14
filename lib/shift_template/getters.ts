'use server';

import prisma from '@/lib/prisma';
import type { ShiftTemplate, ShiftTemplateDetail } from '@/lib/shift_template/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllShiftTemplates(): Promise<ShiftTemplate[]> {
  const shiftTemplates = await prisma.shift_template.findMany({
    include: { user_account: true },
  });
  console.log(`getAllShiftTemplates query completed`);
  return shiftTemplates.map((shiftTemplate) => ({
    id: shiftTemplate.id,
    user_account_id: shiftTemplate.user_account_id,
    day_of_week: shiftTemplate.day_of_week,
    start_time: shiftTemplate.start_time,
    end_time: shiftTemplate.end_time,
    creator_id: shiftTemplate.creator_id,
    user_account: shiftTemplate.user_account,
  }));
}

export async function getShiftTemplateDetail(id: string): Promise<ShiftTemplateDetail | null> {
  const shiftTemplate = await prisma.shift_template.findUnique({
    where: {
      id,
    },
    include: {
      user_account: true, 
    },
  });

  if (!shiftTemplate) {
    return null;
  }

  console.log(`getShiftTemplateDetail completed`);
  return {
    ...shiftTemplate,
  };
}

export async function getShiftTemplateListPageData(isAssertPermission: boolean = true) {
  const t0 = performance.now();
  const [{ permissions: userPermissions, userId }, shiftTemplates] = await Promise.all([
    getModelPermissions('shift_template'),
    getAllShiftTemplates(),
  ]);
  console.log(`Data fetching took ${performance.now() - t0} ms`);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift_template');
  }
  console.log(`Assertion took ${performance.now() - t0} ms`);
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredShiftTemplates = userPermissions.general.read
    ? shiftTemplates
    : shiftTemplates.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  console.log(`Filtering took ${performance.now() - t0} ms`);
  return { shiftTemplates: filteredShiftTemplates, userPermissions: await toPermissions(userPermissions) };
}

export async function getShiftTemplateDetailPageData(id: string, operation: Operation = 'read') {
  const t0 = performance.now();
  const [shiftTemplate, { permissions: basePermissions, userId }] = await Promise.all([
    getShiftTemplateDetail(id),
    getModelPermissions('shift_template'),
  ]);
  console.log(`Data fetching took ${performance.now() - t0} ms`);
  const resolved = await resolvePermissions(basePermissions, shiftTemplate, userId ?? '');
  await assertPermission(resolved, operation, 'shift_template');
  console.log(`Assertion took ${performance.now() - t0} ms`);
  return { shiftTemplate, userPermissions: await toPermissions(resolved) };
}

export async function getShiftTemplateNewPageAccessCheck() {
  const t0 = performance.now();
  const { permissions: richPermissions } = await getModelPermissions('shift_template');
  await assertPermission(richPermissions.general, 'create', 'shift_template');
  console.log(`Access check took ${performance.now() - t0} ms`);
  return richPermissions.general;
}
