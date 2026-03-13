'use server';

import prisma from '@/lib/prisma';
import type { Setting1, Setting1Detail } from '@/lib/setting1/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting1s(): Promise<Setting1[]> {
  const setting1s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting1s.map((setting1) => ({
    id: setting1.id,
    name: setting1.name,
    description: setting1.description,
    team: setting1.team,
  }));
}

export async function getSetting1Detail(id: string): Promise<Setting1Detail | null> {
  const setting1 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting1) {
    return null;
  }

  return {
    ...setting1,
    yyyyy_yyyyys: setting1.yyyyy_yyyyys,
  };
}

export async function getSetting1ListPageData(isAssertPermission: boolean = true) {
  const [userPermissions, setting1s] = await Promise.all([
    getModelPermissions('setting1'),
    getAllSetting1s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting1');
  }
  return { setting1s, userPermissions };
}

export async function getSetting1DetailPageData(id: string, operation: Operation = 'read') {
  const setting1 = await getSetting1Detail(id);
  const userPermissions = await getModelPermissions('setting1', undefined, setting1);
  await assertPermission(userPermissions, operation, 'setting1');
  return { setting1, userPermissions };
}

export async function getSetting1NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting1');
  await assertPermission(userPermissions, 'create', 'setting1');
  return userPermissions;
}
