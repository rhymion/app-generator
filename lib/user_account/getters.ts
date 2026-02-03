'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';
import { canAccess, getModelPermissions, requirePermission } from '@/lib/authz';
import { getAllRoles } from '@/lib/role/getters';

export async function getAllUserAccounts(): Promise<UserAccount[]> {
  await requirePermission('user_account', 'read');

  const userAccounts = await prisma.user_account.findMany({
  });
  return userAccounts.map((userAccount) => ({
    id: userAccount.id,
    name: userAccount.name,
    email: userAccount.email,
    password: userAccount.password,
    api_key: userAccount.api_key,
    avatar: userAccount.avatar,
  }));
}

export async function getUserAccountDetail(id: string): Promise<UserAccountDetail | null> {
  await requirePermission('user_account', 'read');

  const userAccount = await prisma.user_account.findUnique({
    where: { 
      id,
    },
    include: { 
      roles: true 
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

export async function getUserAccountListPageData() {
  await requirePermission('user_account', 'read');
  const [userAccounts, permissions] = await Promise.all([
    getAllUserAccounts(),
    getModelPermissions('user_account'),
  ]);
  return { userAccounts, permissions };
}

export async function getUserAccountDetailPageData(id: string) {
  await requirePermission('user_account', 'read');
  const [userAccount, permissions, canAssignRoles] = await Promise.all([
    getUserAccountDetail(id),
    getModelPermissions('user_account'),
    canAccess('role', 'update'),
  ]);
  if (!userAccount) return null;
  return { userAccount, permissions, canAssignRoles };
}

export async function getUserAccountNewPageData() {
  await requirePermission('user_account', 'create');
  const canAssignRoles = await canAccess('role', 'update');
  const allRoles = canAssignRoles ? await getAllRoles() : [];
  return { allRoles, canAssignRoles };
}

export async function getUserAccountEditPageData(id: string) {
  await requirePermission('user_account', 'update');
  const canAssignRoles = await canAccess('role', 'update');
  const [userAccount, allRoles] = await Promise.all([
    getUserAccountDetail(id),
    canAssignRoles ? getAllRoles() : Promise.resolve([]),
  ]);
  if (!userAccount) return null;
  return { userAccount, allRoles, canAssignRoles };
}
