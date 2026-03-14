'use server';

import prisma from '@/lib/prisma';
import type { Setting8, Setting8Detail } from '@/lib/setting8/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting8s(): Promise<Setting8[]> {
  const setting8s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting8s.map((setting8) => ({
    id: setting8.id,
    name: setting8.name,
    description: setting8.description,
    creator_id: setting8.creator_id,
  }));
}

export async function getSetting8Detail(id: string): Promise<Setting8Detail | null> {
  const setting8 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
  });

  if (!setting8) {
    return null;
  }

  return {
    ...setting8,
  };
}

export async function getSetting8ListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, setting8s] = await Promise.all([
    getModelPermissions('setting8'),
    getAllSetting8s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting8');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting8s = userPermissions.general.read
    ? setting8s
    : setting8s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting8s: filteredSetting8s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting8DetailPageData(id: string, operation: Operation = 'read') {
  const [setting8, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting8Detail(id),
    getModelPermissions('setting8'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting8, userId ?? '');
  await assertPermission(resolved, operation, 'setting8');
  return { setting8, userPermissions: await toPermissions(resolved) };
}

export async function getSetting8NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting8');
  await assertPermission(richPermissions.general, 'create', 'setting8');
  return richPermissions.general;
}
