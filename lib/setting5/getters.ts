'use server';

import prisma from '@/lib/prisma';
import type { Setting5, Setting5Detail } from '@/lib/setting5/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllSetting5s(): Promise<Setting5[]> {
  const setting5s = await prisma.xxxxx_xxxxx.findMany({
  });
  return setting5s.map((setting5) => ({
    id: setting5.id,
    name: setting5.name,
    creator_id: setting5.creator_id,
  }));
}

export async function getSetting5Detail(id: string): Promise<Setting5Detail | null> {
  const setting5 = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting5) {
    return null;
  }

  return {
    ...setting5,
    yyyyy_yyyyys: setting5.yyyyy_yyyyys,
  };
}

export async function getSetting5ListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, setting5s] = await Promise.all([
    getModelPermissions('setting5'),
    getAllSetting5s(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting5');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSetting5s = userPermissions.general.read
    ? setting5s
    : setting5s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { setting5s: filteredSetting5s, userPermissions: await toPermissions(userPermissions) };
}

export async function getSetting5DetailPageData(id: string, operation: Operation = 'read') {
  const [setting5, { permissions: basePermissions, userId }] = await Promise.all([
    getSetting5Detail(id),
    getModelPermissions('setting5'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting5, userId ?? '');
  await assertPermission(resolved, operation, 'setting5');
  return { setting5, userPermissions: await toPermissions(resolved) };
}

export async function getSetting5NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting5');
  await assertPermission(richPermissions.general, 'create', 'setting5');
  return richPermissions.general;
}
