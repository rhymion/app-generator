'use server';

import prisma from '@/lib/prisma';
import type { XxxxxXxxxx, XxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllXxxxxXxxxxs(): Promise<XxxxxXxxxx[]> {
  const xxxxxXxxxxs = await prisma.xxxxx_xxxxx.findMany({
  });
  return xxxxxXxxxxs.map((xxxxxXxxxx) => ({
    id: xxxxxXxxxx.id,
    name: xxxxxXxxxx.name,
    description: xxxxxXxxxx.description,
    team: xxxxxXxxxx.team,
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
  const userPermissions = await getModelPermissions('xxxxx_xxxxx');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'xxxxx_xxxxx');
  }
  const xxxxxXxxxxs = await getAllXxxxxXxxxxs();
  return { xxxxxXxxxxs, userPermissions };
}

export async function getXxxxxXxxxxDetailPageData(id: string, operation: Operation = 'read') {
  const xxxxxXxxxx = await getXxxxxXxxxxDetail(id);
  const userPermissions = await getModelPermissions('xxxxx_xxxxx', undefined, xxxxxXxxxx);
  await assertPermission(userPermissions, operation, 'xxxxx_xxxxx');
  return { xxxxxXxxxx, userPermissions };
}

export async function getXxxxxXxxxxNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('xxxxx_xxxxx');
  await assertPermission(userPermissions, 'create', 'xxxxx_xxxxx');
  return userPermissions;
}
