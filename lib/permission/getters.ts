'use server';

import prisma from '@/lib/prisma';
import type { Permission, PermissionDetail } from '@/lib/permission/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function getAllPermissions(): Promise<Permission[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const permissions = await prisma.permission.findMany({
    include: { role: true },
  });
  return permissions.map((permission) => ({
    id: permission.id,
    name: permission.name,
    create: permission.create,
    read: permission.read,
    update: permission.update,
    remove: permission.remove,
    role_id: permission.role_id,
    role: permission.role,
  }));
}

export async function getPermissionDetail(id: string): Promise<PermissionDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const permission = await prisma.permission.findUnique({
    where: { 
      id,
    },
    include: { role: true },
  });

  if (!permission) {
    return null;
  }

  return {
    ...permission,
  };
}
