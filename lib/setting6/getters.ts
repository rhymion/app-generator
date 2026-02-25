'use server';

import prisma from '@/lib/prisma';
import type { Setting6, Setting6Detail } from '@/lib/setting6/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting6s(): Promise<Setting6[]> {

  const setting6s = await prisma.user_account.findMany({
  });
  return setting6s.map((setting6) => ({
    id: setting6.id,
    name: setting6.name,
    email: setting6.email,
    password: setting6.password,
    api_key: setting6.api_key,
    avatar: setting6.avatar,
  }));
}

export async function getSetting6Detail(id: string): Promise<Setting6Detail | null> {
  
  const setting6 = await prisma.user_account.findUnique({
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

  if (!setting6) {
    return null;
  }

  return {
    ...setting6,
  };
}

export async function getSetting6ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting6s = await getAllSetting6s();
  return { setting6s, userPermissions };
}

export async function getSetting6DetailPageData(id: string, operation: Operation = 'read') {
  const setting6 = await getSetting6Detail(id);
  const userPermissions = await getModelPermissions('user_account', undefined, setting6);
  await assertPermission(userPermissions, operation, 'user_account');
  return { setting6, userPermissions };
}

export async function getSetting6NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
