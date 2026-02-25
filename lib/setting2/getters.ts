'use server';

import prisma from '@/lib/prisma';
import type { Setting2, Setting2Detail } from '@/lib/setting2/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting2s(): Promise<Setting2[]> {

  const setting2s = await prisma.user_account.findMany({
  });
  return setting2s.map((setting2) => ({
    id: setting2.id,
    name: setting2.name,
    email: setting2.email,
    password: setting2.password,
  }));
}

export async function getSetting2Detail(id: string): Promise<Setting2Detail | null> {
  
  const setting2 = await prisma.user_account.findUnique({
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

  if (!setting2) {
    return null;
  }

  return {
    ...setting2,
  };
}

export async function getSetting2ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting2s = await getAllSetting2s();
  return { setting2s, userPermissions };
}

export async function getSetting2DetailPageData(id: string, operation: Operation = 'read') {
  const setting2 = await getSetting2Detail(id);
  const userPermissions = await getModelPermissions('user_account', undefined, setting2);
  await assertPermission(userPermissions, operation, 'user_account');
  return { setting2, userPermissions };
}

export async function getSetting2NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
