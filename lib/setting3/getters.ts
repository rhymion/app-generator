'use server';

import prisma from '@/lib/prisma';
import type { Setting3, Setting3Detail } from '@/lib/setting3/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting3s(): Promise<Setting3[]> {
  const setting3s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting3s.map((setting3) => ({
    id: setting3.id,
    name: setting3.name,
    description: setting3.description,
    creator_id: setting3.creator_id,
  }));
}

export async function getSetting3Detail(id: string): Promise<Setting3Detail | null> {
  const setting3 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
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
  const [{ permissions: userPermissions, userId }, setting3s] = await Promise.all([
    getModelPermissions('setting3'),
    getAllSetting3s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting3');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting3s = userPermissions.general.read
    ? setting3s
    : setting3s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting3s: filteredSetting3s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting3DetailPageData(id: string, operation: Operation = 'read') {
  const [setting3, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting3Detail(id),
    getModelPermissions('setting3'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting3, userId ?? '');
  await assertPermission(resolved, operation, 'setting3');
  return { setting3, userPermissions: await toPermissions(resolved) };
}

export async function getSetting3NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting3');
  await assertPermission(richPermissions.general, 'create', 'setting3');
  return richPermissions.general;
}
