'use server';

import prisma from '@/lib/prisma';
import type { Role, RoleDetail } from '@/lib/role/types';
import { getModelPermissions, requirePermission } from '@/lib/authz';
import { getAllUserAccounts } from '@/lib/user_account/getters';

export async function getAllRoles(): Promise<Role[]> {
  await requirePermission('role', 'read');

  const roles = await prisma.role.findMany({
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
  }));
}

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  await requirePermission('role', 'read');

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
  await requirePermission('role', 'read');
  const [roles, permissions] = await Promise.all([
    getAllRoles(),
    getModelPermissions('role'),
  ]);
  return { roles, permissions };
}

export async function getRoleDetailPageData(id: string) {
  await requirePermission('role', 'read');
  const [role, permissions] = await Promise.all([
    getRoleDetail(id),
    getModelPermissions('role'),
  ]);
  if (!role) return null;
  return { role, permissions };
}

export async function getRoleNewPageData() {
  await requirePermission('role', 'create');
  const allUserAccounts = await getAllUserAccounts();
  return { allUserAccounts };
}

export async function getRoleEditPageData(id: string) {
  await requirePermission('role', 'update');
  const [role, allUserAccounts] = await Promise.all([
    getRoleDetail(id),
    getAllUserAccounts(),
  ]);
  if (!role) return null;
  return { role, allUserAccounts };
}
