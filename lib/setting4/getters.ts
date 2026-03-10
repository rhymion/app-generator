'use server';

import prisma from '@/lib/prisma';
import type { Setting4, Setting4Detail } from '@/lib/setting4/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSetting4s(): Promise<Setting4[]> {
  const setting4s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting4s.map((setting4) => ({
    id: setting4.id,
    name: setting4.name,
    description: setting4.description,
    team: setting4.team,
  }));
}

export async function getSetting4Detail(id: string): Promise<Setting4Detail | null> {
  const setting4 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting4) {
    return null;
  }

  return {
    ...setting4,
  };
}

export async function getSetting4ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('setting4');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting4');
  }
  const setting4s = await getAllSetting4s();
  return { setting4s, userPermissions };
}

export async function getSetting4DetailPageData(id: string, operation: Operation = 'read') {
  const setting4 = await getSetting4Detail(id);
  const userPermissions = await getModelPermissions('setting4', undefined, setting4);
  await assertPermission(userPermissions, operation, 'setting4');
  return { setting4, userPermissions };
}

export async function getSetting4NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting4');
  await assertPermission(userPermissions, 'create', 'setting4');
  return userPermissions;
}
