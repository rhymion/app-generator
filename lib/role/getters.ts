'use server';

import prisma from '@/lib/prisma';
import type { Role, RoleDetail } from '@/lib/role/types';

export async function getAllRoles(): Promise<Role[]> {
  const roles = await prisma.role.findMany();
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
  }));
}

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  const role = await prisma.role.findUnique({
    where: { id },
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
