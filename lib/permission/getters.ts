'use server';

import prisma from '@/lib/prisma';
import type { Permission, PermissionDetail } from '@/lib/permission/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllPermissions(): Promise<Permission[]> {

  const permissions = await prisma.permission.findMany({
    include: { role: true },
  });
  return permissions.map((permission) => ({
    id: permission.id,
    name: permission.name,
    create: permission.create,
    read: permission.read,
    update: permission.update,
    delete: permission.delete,
    role_id: permission.role_id,
    role: permission.role,
  }));
}

export async function getPermissionDetail(id: string): Promise<PermissionDetail | null> {
  
  const permission = await prisma.permission.findUnique({
    where: { 
      id,
    },
    include: { 
      role: true, 
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
    },
  });

  if (!permission) {
    return null;
  }

  return {
    ...permission,
    role: permission.role,
  };
}

export async function getPermissionListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('permission');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'permission');
  }
  const permissions = await getAllPermissions();
  return { permissions, userPermissions };
}

export async function getPermissionDetailPageData(id: string, operation: Operation = 'read') {
  const permission = await getPermissionDetail(id);
  const userPermissions = await getModelPermissions('permission', undefined, permission);
  await assertPermission(userPermissions, operation, 'permission');
  return { permission, userPermissions };
}

export async function getPermissionNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('permission');
  await assertPermission(userPermissions, 'create', 'permission');
  return userPermissions;
}
