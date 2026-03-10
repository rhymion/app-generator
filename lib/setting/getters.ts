'use server';

import prisma from '@/lib/prisma';
import type { Setting, SettingDetail } from '@/lib/setting/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllSettings(): Promise<Setting[]> {
  const settings = await prisma.user_account.findMany({
  });
  return settings.map((setting) => ({
    id: setting.id,
    name: setting.name,
    email: setting.email,
    password: setting.password,
    api_key: setting.api_key,
    avatar: setting.avatar,
  }));
}

export async function getSettingDetail(id: string): Promise<SettingDetail | null> {
  const setting = await prisma.user_account.findUnique({
    where: {
      id,
    },
    include: {
      roles: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!setting) {
    return null;
  }

  return {
    ...setting,
    roles: setting.roles,
  };
}

export async function getSettingListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('setting');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting');
  }
  const settings = await getAllSettings();
  return { settings, userPermissions };
}

export async function getSettingDetailPageData(id: string, operation: Operation = 'read') {
  const setting = await getSettingDetail(id);
  const userPermissions = await getModelPermissions('setting', undefined, setting);
  await assertPermission(userPermissions, operation, 'setting');
  return { setting, userPermissions };
}

export async function getSettingNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('setting');
  await assertPermission(userPermissions, 'create', 'setting');
  return userPermissions;
}
