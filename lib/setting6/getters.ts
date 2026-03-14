'use server';

import prisma from '@/lib/prisma';
import type { Setting6, Setting6Detail } from '@/lib/setting6/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting6s(): Promise<Setting6[]> {
  const setting6s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting6s.map((setting6) => ({
    id: setting6.id,
    name: setting6.name,
    description: setting6.description,
    team: setting6.team,
    creator_id: setting6.creator_id,
  }));
}

export async function getSetting6Detail(id: string): Promise<Setting6Detail | null> {
  const setting6 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true
    },
  });

  if (!setting6) {
    return null;
  }

  return {
    ...setting6,
  };
}

export async function getSetting6ListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, setting6s] = await Promise.all([
    getModelPermissions('setting6'),
    getAllSetting6s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting6');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting6s = userPermissions.general.read
    ? setting6s
    : setting6s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting6s: filteredSetting6s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting6DetailPageData(id: string, operation: Operation = 'read') {
  const [setting6, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting6Detail(id),
    getModelPermissions('setting6'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting6, userId ?? '');
  await assertPermission(resolved, operation, 'setting6');
  return { setting6, userPermissions: await toPermissions(resolved) };
}

export async function getSetting6NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting6');
  await assertPermission(richPermissions.general, 'create', 'setting6');
  return richPermissions.general;
}
