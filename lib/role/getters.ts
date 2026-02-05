'use server';

import prisma from '@/lib/prisma';
import type { Role, RoleDetail } from '@/lib/role/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import { getAllUserAccounts } from '@/lib/user_account/getters';

export async function getAllRoles(permissions?: ModelPermissions): Promise<Role[]> {
  const resolvedPermissions = permissions ?? (await getModelPermissions('role'));
  assertPermission(resolvedPermissions, 'read', 'role');

  const roles = await prisma.role.findMany({
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
  }));
}

export async function getRoleDetail(id: string, permissions?: ModelPermissions): Promise<RoleDetail | null> {
  const resolvedPermissions = permissions ?? (await getModelPermissions('role'));
  assertPermission(resolvedPermissions, 'read', 'role');

  const role = await prisma.role.findUnique({
    where: { 
      id,
    },
    include: { 
      user_accounts: true 
    },
  });

  if (!role) {
    return null;
  }

  return {
    ...role,
    user_accounts: role.user_accounts,
  };
}

export async function getRoleListPageData() {
  const permissions = await getModelPermissions('role');
  assertPermission(permissions, 'read', 'role');
  const roles = await getAllRoles(permissions);
  return { roles, permissions };
}

export async function getRoleDetailPageData(id: string) {
  const permissions = await getModelPermissions('role');
  assertPermission(permissions, 'read', 'role');
  const role = await getRoleDetail(id, permissions);
  if (!role) return null;
  return { role, permissions };
}

export async function getRoleNewPageData() {
  const permissions = await getModelPermissions('role');
  assertPermission(permissions, 'create', 'role');
  const allUserAccounts = await getAllUserAccounts();
  return { allUserAccounts, permissions };
}

export async function getRoleEditPageData(id: string) {
  const permissions = await getModelPermissions('role');
  assertPermission(permissions, 'update', 'role');
  const [role, allUserAccounts] = await Promise.all([
    getRoleDetail(id, permissions),
    getAllUserAccounts(),
  ]);
  if (!role) return null;
  return { role, allUserAccounts, permissions };
}
