'use server';

import prisma from '@/lib/prisma';
import type { Setting5, Setting5Detail } from '@/lib/setting5/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting5s(): Promise<Setting5[]> {
  const setting5s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting5s.map((setting5) => ({
    id: setting5.id,
    name: setting5.name,
  }));
}

export async function getSetting5Detail(id: string): Promise<Setting5Detail | null> {
  const setting5 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting5) {
    return null;
  }

  return {
    ...setting5,
    yyyyy_yyyyys: setting5.yyyyy_yyyyys,
  };
}

export async function getSetting5ListPageData(isAssertPermission: boolean = true) {
  const [userPermissions, setting5s] = await Promise.all([
    getModelPermissions('setting5'),
    getAllSetting5s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting5');
  }
  return { setting5s, userPermissions };
}

export async function getSetting5DetailPageData(id: string, operation: Operation = 'read') {
  const setting5 = await getSetting5Detail(id);
  const userPermissions = await getModelPermissions('setting5', undefined, setting5);
  await assertPermission(userPermissions, operation, 'setting5');
  return { setting5, userPermissions };
}

export async function getSetting5NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting5');
  await assertPermission(userPermissions, 'create', 'setting5');
  return userPermissions;
}
