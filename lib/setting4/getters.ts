'use server';

import prisma from '@/lib/prisma';
import type { Setting4, Setting4Detail } from '@/lib/setting4/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting4s(): Promise<Setting4[]> {
  const setting4s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting4s.map((setting4) => ({
    id: setting4.id,
    name: setting4.name,
    description: setting4.description,
    team: setting4.team,
    creator_id: setting4.creator_id,
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
  const [{ permissions: userPermissions, userId }, setting4s] = await Promise.all([
    getModelPermissions('setting4'),
    getAllSetting4s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting4');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting4s = userPermissions.general.read
    ? setting4s
    : setting4s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting4s: filteredSetting4s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting4DetailPageData(id: string, operation: Operation = 'read') {
  const [setting4, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting4Detail(id),
    getModelPermissions('setting4'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting4, userId ?? '');
  await assertPermission(resolved, operation, 'setting4');
  return { setting4, userPermissions: await toPermissions(resolved) };
}

export async function getSetting4NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting4');
  await assertPermission(richPermissions.general, 'create', 'setting4');
  return richPermissions.general;
}
