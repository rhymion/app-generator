'use server';

import prisma from '@/lib/prisma';
import type { Permission, PermissionDetail } from '@/lib/permission/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

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
    creator_id: permission.creator_id,
    role: permission.role,
  }));
}

export async function getPermissionDetail(id: string): Promise<PermissionDetail | null> {
  const permission = await prisma.permission.findUnique({
    where: {
      id,
    },
    include: {
      role: true
    },
  });

  if (!permission) {
    return null;
  }

  return {
    ...permission,
  };
}

export async function getPermissionListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, permissions] = await Promise.all([
    getModelPermissions('permission'),
    getAllPermissions(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'permission');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredPermissions = userPermissions.general.read
    ? permissions
    : permissions.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { permissions: filteredPermissions, userPermissions: await toPermissions(userPermissions) };
}

export async function getPermissionDetailPageData(id: string, operation: Operation = 'read') {
  const [permission, { permissions: basePermissions, userId }] = await Promise.all([
    getPermissionDetail(id),
    getModelPermissions('permission'),
  ]);
  const resolved = await resolvePermissions(basePermissions, permission, userId ?? '');
  await assertPermission(resolved, operation, 'permission');
  return { permission, userPermissions: await toPermissions(resolved) };
}

export async function getPermissionNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('permission');
  await assertPermission(richPermissions.general, 'create', 'permission');
  return richPermissions.general;
}
