'use server';

import prisma from '@/lib/prisma';
import type { ShiftTemplate, ShiftTemplateDetail } from '@/lib/shift_template/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllShiftTemplates(): Promise<ShiftTemplate[]> {
  const shiftTemplates = await prisma.shift_template.findMany({
    include: { user_account: true },
  });
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
      user_account: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!shiftTemplate) {
    return null;
  }

  return {
    ...shiftTemplate,
    user_account: shiftTemplate.user_account,
  };
}

export async function getShiftTemplateListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, shiftTemplates] = await Promise.all([
    getModelPermissions('shift_template'),
    getAllShiftTemplates(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift_template');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredShiftTemplates = userPermissions.general.read
    ? shiftTemplates
    : shiftTemplates.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { shiftTemplates: filteredShiftTemplates, userPermissions: await toPermissions(userPermissions) };
}

export async function getShiftTemplateDetailPageData(id: string, operation: Operation = 'read') {
  const [shiftTemplate, { permissions: basePermissions, userId }] = await Promise.all([
    getShiftTemplateDetail(id),
    getModelPermissions('shift_template'),
  ]);
  const resolved = await resolvePermissions(basePermissions, shiftTemplate, userId ?? '');
  await assertPermission(resolved, operation, 'shift_template');
  return { shiftTemplate, userPermissions: await toPermissions(resolved) };
}

export async function getShiftTemplateNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('shift_template');
  await assertPermission(richPermissions.general, 'create', 'shift_template');
  return richPermissions.general;
}
