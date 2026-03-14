'use server';

import prisma from '@/lib/prisma';
import type { Setting2, Setting2Detail } from '@/lib/setting2/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting2s(): Promise<Setting2[]> {
  const setting2s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting2s.map((setting2) => ({
    id: setting2.id,
    name: setting2.name,
    description: setting2.description,
    creator_id: setting2.creator_id,
  }));
}

export async function getSetting2Detail(id: string): Promise<Setting2Detail | null> {
  const setting2 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
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
  const [{ permissions: userPermissions, userId }, setting2s] = await Promise.all([
    getModelPermissions('setting2'),
    getAllSetting2s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting2');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting2s = userPermissions.general.read
    ? setting2s
    : setting2s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting2s: filteredSetting2s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting2DetailPageData(id: string, operation: Operation = 'read') {
  const [setting2, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting2Detail(id),
    getModelPermissions('setting2'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting2, userId ?? '');
  await assertPermission(resolved, operation, 'setting2');
  return { setting2, userPermissions: await toPermissions(resolved) };
}

export async function getSetting2NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting2');
  await assertPermission(richPermissions.general, 'create', 'setting2');
  return richPermissions.general;
}
