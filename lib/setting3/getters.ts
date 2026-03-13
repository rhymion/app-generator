'use server';

import prisma from '@/lib/prisma';
import type { Setting3, Setting3Detail } from '@/lib/setting3/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting3s(): Promise<Setting3[]> {
  const setting3s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting3s.map((setting3) => ({
    id: setting3.id,
    name: setting3.name,
    description: setting3.description,
  }));
}

export async function getSetting3Detail(id: string): Promise<Setting3Detail | null> {
  const setting3 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting3) {
    return null;
  }

  return {
    ...setting3,
  };
}

export async function getSetting3ListPageData(isAssertPermission: boolean = true) {
  const [userPermissions, setting3s] = await Promise.all([
    getModelPermissions('setting3'),
    getAllSetting3s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting3');
  }
  return { setting3s, userPermissions };
}

export async function getSetting3DetailPageData(id: string, operation: Operation = 'read') {
  const setting3 = await getSetting3Detail(id);
  const userPermissions = await getModelPermissions('setting3', undefined, setting3);
  await assertPermission(userPermissions, operation, 'setting3');
  return { setting3, userPermissions };
}

export async function getSetting3NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting3');
  await assertPermission(userPermissions, 'create', 'setting3');
  return userPermissions;
}
