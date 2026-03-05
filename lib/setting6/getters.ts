'use server';

import prisma from '@/lib/prisma';
import type { Setting6, Setting6Detail } from '@/lib/setting6/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting6s(): Promise<Setting6[]> {

  const setting6s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting6s.map((setting6) => ({
    id: setting6.id,
    name: setting6.name,
    description: setting6.description,
    team: setting6.team,
  }));
}

export async function getSetting6Detail(id: string): Promise<Setting6Detail | null> {
  
  const setting6 = await prisma.xxxxx_xxxxx.findUnique({
    where: { 
      id,
    },
    include: { 
      yyyyy_yyyyys: true, 
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
    yyyyy_yyyyys: setting6.yyyyy_yyyyys,
  };
}

export async function getSetting6ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('setting6');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting6');
  }
  const setting6s = await getAllSetting6s();
  return { setting6s, userPermissions };
}

export async function getSetting6DetailPageData(id: string, operation: Operation = 'read') {
  const setting6 = await getSetting6Detail(id);
  const userPermissions = await getModelPermissions('setting6', undefined, setting6);
  await assertPermission(userPermissions, operation, 'setting6');
  return { setting6, userPermissions };
}

export async function getSetting6NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting6');
  await assertPermission(userPermissions, 'create', 'setting6');
  return userPermissions;
}
