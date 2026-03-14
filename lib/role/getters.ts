'use server';

import prisma from '@/lib/prisma';
import type { Role, RoleDetail } from '@/lib/role/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllRoles(): Promise<Role[]> {
  const roles = await prisma.role.findMany({
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    creator_id: role.creator_id,
  }));
}

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  const role = await prisma.role.findUnique({
    where: {
      id,
    },
    include: {
      user_accounts: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
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
  const [{ permissions: userPermissions, userId }, roles] = await Promise.all([
    getModelPermissions('role'),
    getAllRoles(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'role');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredRoles = userPermissions.general.read
    ? roles
    : roles.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { roles: filteredRoles, userPermissions: await toPermissions(userPermissions) };
}

export async function getRoleDetailPageData(id: string, operation: Operation = 'read') {
  const [role, { permissions: basePermissions, userId }] = await Promise.all([
    getRoleDetail(id),
    getModelPermissions('role'),
  ]);
  const resolved = await resolvePermissions(basePermissions, role, userId ?? '');
  await assertPermission(resolved, operation, 'role');
  return { role, userPermissions: await toPermissions(resolved) };
}

export async function getRoleNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('role');
  await assertPermission(richPermissions.general, 'create', 'role');
  return richPermissions.general;
}
