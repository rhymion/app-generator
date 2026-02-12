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
  }));
}

export async function getSettingDetail(id: string): Promise<SettingDetail | null> {
  
  const setting = await prisma.user_account.findUnique({
    where: { 
      id,
    },
  });

  if (!setting) {
    return null;
  }

  return {
    ...setting,
  };
}

export async function getSettingListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('user_account');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  const settings = await getAllSettings();
  return { settings, userPermissions };
}

export async function getSettingDetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, operation, 'user_account');
  const setting = await getSettingDetail(id);
  return { setting, userPermissions };
}

export async function getSettingNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
