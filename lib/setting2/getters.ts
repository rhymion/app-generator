'use server';

import prisma from '@/lib/prisma';
import type { Setting2, Setting2Detail } from '@/lib/setting2/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting2s(): Promise<Setting2[]> {
  const setting2s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting2s.map((setting2) => ({
    id: setting2.id,
    name: setting2.name,
    description: setting2.description,
  }));
}

export async function getSetting2Detail(id: string): Promise<Setting2Detail | null> {
  const setting2 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
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
  const userPermissions = await getModelPermissions('setting2');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting2');
  }
  const setting2s = await getAllSetting2s();
  return { setting2s, userPermissions };
}

export async function getSetting2DetailPageData(id: string, operation: Operation = 'read') {
  const setting2 = await getSetting2Detail(id);
  const userPermissions = await getModelPermissions('setting2', undefined, setting2);
  await assertPermission(userPermissions, operation, 'setting2');
  return { setting2, userPermissions };
}

export async function getSetting2NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting2');
  await assertPermission(userPermissions, 'create', 'setting2');
  return userPermissions;
}
