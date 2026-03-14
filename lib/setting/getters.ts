'use server';

import prisma from '@/lib/prisma';
import type { Setting, SettingDetail } from '@/lib/setting/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

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
    creator_id: setting.creator_id,
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
  const [{ permissions: userPermissions, userId }, settings] = await Promise.all([
    getModelPermissions('setting'),
    getAllSettings(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'setting');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredSettings = userPermissions.general.read
    ? settings
    : settings.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { settings: filteredSettings, userPermissions: await toPermissions(userPermissions) };
}

export async function getSettingDetailPageData(id: string, operation: Operation = 'read') {
  const [setting, { permissions: basePermissions, userId }] = await Promise.all([
    getSettingDetail(id),
    getModelPermissions('setting'),
  ]);
  const resolved = await resolvePermissions(basePermissions, setting, userId ?? '');
  await assertPermission(resolved, operation, 'setting');
  return { setting, userPermissions: await toPermissions(resolved) };
}

export async function getSettingNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('setting');
  await assertPermission(richPermissions.general, 'create', 'setting');
  return richPermissions.general;
}
