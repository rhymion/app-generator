'use server';

import prisma from '@/lib/prisma';
import type { ParentOnly, ParentOnlyDetail } from '@/lib/parent_only/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllParentOnlys(): Promise<ParentOnly[]> {
  const parentOnlys = await prisma.parent_only.findMany({
  });
  return parentOnlys.map((parentOnly) => ({
    id: parentOnly.id,
    name: parentOnly.name,
    description: parentOnly.description,
    login_time: parentOnly.login_time,
    logout_time: parentOnly.logout_time,
    creator_id: parentOnly.creator_id,
  }));
}

export async function getParentOnlyDetail(id: string): Promise<ParentOnlyDetail | null> {
  const parentOnly = await prisma.parent_only.findUnique({
    where: {
      id,
    },
  });

  if (!parentOnly) {
    return null;
  }

  return {
    ...parentOnly,
  };
}

export async function getParentOnlyListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, parentOnlys] = await Promise.all([
    getModelPermissions('parent_only'),
    getAllParentOnlys(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'parent_only');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredParentOnlys = userPermissions.general.read
    ? parentOnlys
    : parentOnlys.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { parentOnlys: filteredParentOnlys, userPermissions: await toPermissions(userPermissions) };
}

export async function getParentOnlyDetailPageData(id: string, operation: Operation = 'read') {
  const [parentOnly, { permissions: basePermissions, userId }] = await Promise.all([
    getParentOnlyDetail(id),
    getModelPermissions('parent_only'),
  ]);
  const resolved = await resolvePermissions(basePermissions, parentOnly, userId ?? '');
  await assertPermission(resolved, operation, 'parent_only');
  return { parentOnly, userPermissions: await toPermissions(resolved) };
}

export async function getParentOnlyNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('parent_only');
  await assertPermission(richPermissions.general, 'create', 'parent_only');
  return richPermissions.general;
}
