'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, canAccess, getModelPermissions } from '@/lib/authz';
import { getAllRoles } from '@/lib/role/getters';

export async function getAllUserAccounts(permissions?: ModelPermissions): Promise<UserAccount[]> {
  const resolvedPermissions = permissions ?? (await getModelPermissions('user_account'));
  await assertPermission(resolvedPermissions, 'read', 'user_account');

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

export async function getUserAccountDetail(id: string, permissions?: ModelPermissions): Promise<UserAccountDetail | null> {
  const resolvedPermissions = permissions ?? (await getModelPermissions('user_account'));
  await assertPermission(resolvedPermissions, 'read', 'user_account');

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
  const permissions = await getModelPermissions('user_account');
  await assertPermission(permissions, 'read', 'user_account');
  const userAccounts = await getAllUserAccounts(permissions);
  return { userAccounts, permissions };
}

export async function getUserAccountDetailPageData(id: string) {
  const permissions = await getModelPermissions('user_account');
  await assertPermission(permissions, 'read', 'user_account');
  const [userAccount, canAssignRoles] = await Promise.all([
    getUserAccountDetail(id, permissions),
    canAccess('role', 'update'),
  ]);
  if (!userAccount) return null;
  return { userAccount, permissions, canAssignRoles };
}

export async function getUserAccountNewPageData() {
  const permissions = await getModelPermissions('user_account');
  await assertPermission(permissions, 'create', 'user_account');
  const canAssignRoles = await canAccess('role', 'update');
  const allRoles = canAssignRoles ? await getAllRoles() : [];
  return { allRoles, canAssignRoles, permissions };
}

export async function getUserAccountEditPageData(id: string) {
  const permissions = await getModelPermissions('user_account');
  await assertPermission(permissions, 'update', 'user_account');
  const canAssignRoles = await canAccess('role', 'update');
  const [userAccount, allRoles] = await Promise.all([
    getUserAccountDetail(id, permissions),
    canAssignRoles ? getAllRoles() : Promise.resolve([]),
  ]);
  if (!userAccount) return null;
  return { userAccount, allRoles, canAssignRoles, permissions };
}
