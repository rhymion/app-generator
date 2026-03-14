'use server';

import prisma from '@/lib/prisma';
import type { Setting7, Setting7Detail } from '@/lib/setting7/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting7s(): Promise<Setting7[]> {
  const setting7s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting7s.map((setting7) => ({
    id: setting7.id,
    name: setting7.name,
    description: setting7.description,
    team: setting7.team,
    creator_id: setting7.creator_id,
  }));
}

export async function getSetting7Detail(id: string): Promise<Setting7Detail | null> {
  const setting7 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
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
  const [{ permissions: userPermissions, userId }, setting7s] = await Promise.all([
    getModelPermissions('setting7'),
    getAllSetting7s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting7');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting7s = userPermissions.general.read
    ? setting7s
    : setting7s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting7s: filteredSetting7s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting7DetailPageData(id: string, operation: Operation = 'read') {
  const [setting7, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting7Detail(id),
    getModelPermissions('setting7'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting7, userId ?? '');
  await assertPermission(resolved, operation, 'setting7');
  return { setting7, userPermissions: await toPermissions(resolved) };
}

export async function getSetting7NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting7');
  await assertPermission(richPermissions.general, 'create', 'setting7');
  return richPermissions.general;
}
