'use server';

import prisma from '@/lib/prisma';
import type { Setting5, Setting5Detail } from '@/lib/setting5/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting5s(): Promise<Setting5[]> {

  const setting5s = await prisma.user_account.findMany({
  });
  return setting5s.map((setting5) => ({
    id: setting5.id,
    name: setting5.name,
    email: setting5.email,
  }));
}

export async function getSetting5Detail(id: string): Promise<Setting5Detail | null> {
  
  const setting5 = await prisma.user_account.findUnique({
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

  if (!setting5) {
    return null;
  }

  return {
    ...setting5,
  };
}

export async function getSetting5ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting5s = await getAllSetting5s();
  return { setting5s, userPermissions };
}

export async function getSetting5DetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, operation, 'user_account');
  const setting5 = await getSetting5Detail(id);
  return { setting5, userPermissions };
}

export async function getSetting5NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
