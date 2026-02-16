'use server';

import prisma from '@/lib/prisma';
import type { ParentOnly, ParentOnlyDetail } from '@/lib/parent_only/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllParentOnlys(): Promise<ParentOnly[]> {

  const parentOnlys = await prisma.parent_only.findMany({
  });
  return parentOnlys.map((parentOnly) => ({
    id: parentOnly.id,
    name: parentOnly.name,
    description: parentOnly.description,
    login_time: parentOnly.login_time,
    logout_time: parentOnly.logout_time,
  }));
}

export async function getParentOnlyDetail(id: string): Promise<ParentOnlyDetail | null> {
  
  const parentOnly = await prisma.parent_only.findUnique({
    where: { 
      id,
    },
    include: { 
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
    },
  });

  if (!parentOnly) {
    return null;
  }

  return {
    ...parentOnly,
  };
}

export async function getParentOnlyListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('parent_only');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'parent_only');
  }
  const parentOnlys = await getAllParentOnlys();
  return { parentOnlys, userPermissions };
}

export async function getParentOnlyDetailPageData(id: string, operation: Operation = 'read') {
  const parentOnly = await getParentOnlyDetail(id);
  const userPermissions = await getModelPermissions('parent_only', undefined, parentOnly);
  await assertPermission(userPermissions, operation, 'parent_only');
  return { parentOnly, userPermissions };
}

export async function getParentOnlyNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('parent_only');
  await assertPermission(userPermissions, 'create', 'parent_only');
  return userPermissions;
}
