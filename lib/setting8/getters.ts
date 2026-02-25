'use server';

import prisma from '@/lib/prisma';
import type { Setting8, Setting8Detail } from '@/lib/setting8/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting8s(): Promise<Setting8[]> {

  const setting8s = await prisma.user_account.findMany({
  });
  return setting8s.map((setting8) => ({
    id: setting8.id,
    name: setting8.name,
    email: setting8.email,
    password: setting8.password,
  }));
}

export async function getSetting8Detail(id: string): Promise<Setting8Detail | null> {
  
  const setting8 = await prisma.user_account.findUnique({
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

  if (!setting8) {
    return null;
  }

  return {
    ...setting8,
  };
}

export async function getSetting8ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting8s = await getAllSetting8s();
  return { setting8s, userPermissions };
}

export async function getSetting8DetailPageData(id: string, operation: Operation = 'read') {
  const setting8 = await getSetting8Detail(id);
  const userPermissions = await getModelPermissions('user_account', undefined, setting8);
  await assertPermission(userPermissions, operation, 'user_account');
  return { setting8, userPermissions };
}

export async function getSetting8NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
