'use server';

import prisma from '@/lib/prisma';
import type { XxxxxXxxxx, XxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllXxxxxXxxxxs(): Promise<XxxxxXxxxx[]> {
  const xxxxxXxxxxs = await prisma.xxxxx_xxxxx.findMany({
  });
  return xxxxxXxxxxs.map((xxxxxXxxxx) => ({
    id: xxxxxXxxxx.id,
    name: xxxxxXxxxx.name,
    description: xxxxxXxxxx.description,
    team: xxxxxXxxxx.team,
    creator_id: xxxxxXxxxx.creator_id,
  }));
}

export async function getXxxxxXxxxxDetail(id: string): Promise<XxxxxXxxxxDetail | null> {
  const xxxxxXxxxx = await prisma.xxxxx_xxxxx.findUnique({
    where: {
      id,
    },
    include: {
      yyyyy_yyyyys: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!xxxxxXxxxx) {
    return null;
  }

  return {
    ...xxxxxXxxxx,
    yyyyy_yyyyys: xxxxxXxxxx.yyyyy_yyyyys,
  };
}

export async function getXxxxxXxxxxListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, xxxxxXxxxxs] = await Promise.all([
    getModelPermissions('xxxxx_xxxxx'),
    getAllXxxxxXxxxxs(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'xxxxx_xxxxx');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredXxxxxXxxxxs = userPermissions.general.read
    ? xxxxxXxxxxs
    : xxxxxXxxxxs.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { xxxxxXxxxxs: filteredXxxxxXxxxxs, userPermissions: await toPermissions(userPermissions) };
}

export async function getXxxxxXxxxxDetailPageData(id: string, operation: Operation = 'read') {
  const [xxxxxXxxxx, { permissions: basePermissions, userId }] = await Promise.all([
    getXxxxxXxxxxDetail(id),
    getModelPermissions('xxxxx_xxxxx'),
  ]);
  const resolved = await resolvePermissions(basePermissions, xxxxxXxxxx, userId ?? '');
  await assertPermission(resolved, operation, 'xxxxx_xxxxx');
  return { xxxxxXxxxx, userPermissions: await toPermissions(resolved) };
}

export async function getXxxxxXxxxxNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('xxxxx_xxxxx');
  await assertPermission(richPermissions.general, 'create', 'xxxxx_xxxxx');
  return richPermissions.general;
}
