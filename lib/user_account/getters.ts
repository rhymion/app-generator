'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllUserAccounts(): Promise<UserAccount[]> {
  const userAccounts = await prisma.user_account.findMany({
  });
  return userAccounts.map((userAccount) => ({
    id: userAccount.id,
    name: userAccount.name,
    avatar: userAccount.avatar,
    creator_id: userAccount.creator_id,
  }));
}

export async function getUserAccountDetail(id: string): Promise<UserAccountDetail | null> {
  const userAccount = await prisma.user_account.findUnique({
    where: {
      id,
    },
    include: {
      roles: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!userAccount) {
    return null;
  }

  return {
    ...userAccount,
    roles: userAccount.roles,
  };
}

export async function getUserAccountListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, userAccounts] = await Promise.all([
    getModelPermissions('user_account'),
    getAllUserAccounts(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredUserAccounts = userPermissions.general.read
    ? userAccounts
    : userAccounts.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { userAccounts: filteredUserAccounts, userPermissions: await toPermissions(userPermissions) };
}

export async function getUserAccountDetailPageData(id: string, operation: Operation = 'read') {
  const [userAccount, { permissions: basePermissions, userId }] = await Promise.all([
    getUserAccountDetail(id),
    getModelPermissions('user_account'),
  ]);
  const resolved = await resolvePermissions(basePermissions, userAccount, userId ?? '');
  await assertPermission(resolved, operation, 'user_account');
  return { userAccount, userPermissions: await toPermissions(resolved) };
}

export async function getUserAccountNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('user_account');
  await assertPermission(richPermissions.general, 'create', 'user_account');
  return richPermissions.general;
}
