'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllUserAccounts(): Promise<UserAccount[]> {
  const userAccounts = await prisma.user_account.findMany({
  });
  return userAccounts.map((userAccount) => ({
    id: userAccount.id,
    name: userAccount.name,
    avatar: userAccount.avatar,
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
  const [userPermissions, userAccounts] = await Promise.all([
    getModelPermissions('user_account'),
    getAllUserAccounts(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'user_account');
  }
  return { userAccounts, userPermissions };
}

export async function getUserAccountDetailPageData(id: string, operation: Operation = 'read') {
  const userAccount = await getUserAccountDetail(id);
  const userPermissions = await getModelPermissions('user_account', undefined, userAccount);
  await assertPermission(userPermissions, operation, 'user_account');
  return { userAccount, userPermissions };
}

export async function getUserAccountNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('user_account');
  await assertPermission(userPermissions, 'create', 'user_account');
  return userPermissions;
}
