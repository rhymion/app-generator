'use server';

import prisma from '@/lib/prisma';
import type { ShiftTemplate, ShiftTemplateDetail } from '@/lib/shift_template/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

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
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
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
  const userPermissions = await getModelPermissions('shift_template');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'shift_template');
  }
  const shiftTemplates = await getAllShiftTemplates();
  return { shiftTemplates, userPermissions };
}

export async function getShiftTemplateDetailPageData(id: string, operation: Operation = 'read') {
  const shiftTemplate = await getShiftTemplateDetail(id);
  const userPermissions = await getModelPermissions('shift_template', undefined, shiftTemplate);
  await assertPermission(userPermissions, operation, 'shift_template');
  return { shiftTemplate, userPermissions };
}

export async function getShiftTemplateNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('shift_template');
  await assertPermission(userPermissions, 'create', 'shift_template');
  return userPermissions;
}
