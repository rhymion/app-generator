'use server';

import prisma from '@/lib/prisma';
import type { Role, RoleDetail } from '@/lib/role/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllRoles(): Promise<Role[]> {

  const roles = await prisma.role.findMany({
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
  }));
}

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  
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

export async function getRoleListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('role');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'role');
  }
  const roles = await getAllRoles();
  return { roles, userPermissions };
}

export async function getRoleDetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('role');
  await assertPermission(userPermissions, operation, 'role');
  const role = await getRoleDetail(id);
  return { role, userPermissions };
}

export async function getRoleNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('role');
  await assertPermission(userPermissions, 'create', 'role');
  return userPermissions;
}
