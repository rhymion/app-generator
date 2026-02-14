'use server';

import prisma from '@/lib/prisma';
import type { Setting1, Setting1Detail } from '@/lib/setting1/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting1s(): Promise<Setting1[]> {

  const setting1s = await prisma.user_account.findMany({
  });
  return setting1s.map((setting1) => ({
    id: setting1.id,
    name: setting1.name,
    email: setting1.email,
    password: setting1.password,
    api_key: setting1.api_key,
    avatar: setting1.avatar,
  }));
}

export async function getSetting1Detail(id: string): Promise<Setting1Detail | null> {
  
  const setting1 = await prisma.user_account.findUnique({
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

  if (!setting1) {
    return null;
  }

  return {
    ...setting1,
  };
}

export async function getSetting1ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const setting1s = await getAllSetting1s();
  return { setting1s, userPermissions };
}

export async function getSetting1DetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, operation, 'user_account');
  const setting1 = await getSetting1Detail(id);
  return { setting1, userPermissions };
}

export async function getSetting1NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
