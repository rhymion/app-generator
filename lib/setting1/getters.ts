'use server';

import prisma from '@/lib/prisma';
import type { Setting1, Setting1Detail } from '@/lib/setting1/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting1s(): Promise<Setting1[]> {
  const setting1s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting1s.map((setting1) => ({
    id: setting1.id,
    name: setting1.name,
    description: setting1.description,
    team: setting1.team,
    creator_id: setting1.creator_id,
  }));
}

export async function getSetting1Detail(id: string): Promise<Setting1Detail | null> {
  const setting1 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true
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
  const [{ permissions: userPermissions, userId }, setting1s] = await Promise.all([
    getModelPermissions('setting1'),
    getAllSetting1s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting1');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting1s = userPermissions.general.read
    ? setting1s
    : setting1s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting1s: filteredSetting1s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting1DetailPageData(id: string, operation: Operation = 'read') {
  const [setting1, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting1Detail(id),
    getModelPermissions('setting1'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting1, userId ?? '');
  await assertPermission(resolved, operation, 'setting1');
  return { setting1, userPermissions: await toPermissions(resolved) };
}

export async function getSetting1NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting1');
  await assertPermission(richPermissions.general, 'create', 'setting1');
  return richPermissions.general;
}
