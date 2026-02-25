'use server';

import prisma from '@/lib/prisma';
import type { Setting7, Setting7Detail } from '@/lib/setting7/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting7s(): Promise<Setting7[]> {

  const setting7s = await prisma.user_account.findMany({
  });
  return setting7s.map((setting7) => ({
    id: setting7.id,
    name: setting7.name,
    email: setting7.email,
    password: setting7.password,
    api_key: setting7.api_key,
    avatar: setting7.avatar,
  }));
}

export async function getSetting7Detail(id: string): Promise<Setting7Detail | null> {
  
  const setting7 = await prisma.user_account.findUnique({
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

  if (!setting7) {
    return null;
  }

  return {
    ...setting7,
  };
}

export async function getSetting7ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting7s = await getAllSetting7s();
  return { setting7s, userPermissions };
}

export async function getSetting7DetailPageData(id: string, operation: Operation = 'read') {
  const setting7 = await getSetting7Detail(id);
  const userPermissions = await getModelPermissions('user_account', undefined, setting7);
  await assertPermission(userPermissions, operation, 'user_account');
  return { setting7, userPermissions };
}

export async function getSetting7NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
