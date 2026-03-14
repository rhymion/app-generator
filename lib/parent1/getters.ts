'use server';

import prisma from '@/lib/prisma';
import type { Parent1, Parent1Detail } from '@/lib/parent1/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions, getSessionUserIdOrThrow } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export async function getAllParent1s(userId: string): Promise<Parent1[]> {
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const parent1s = await prisma.parent1.findMany({
    where: {
      organization_id: { in: associatedOrganizationIds },
    },
    include: { organization: true },
  });
  return parent1s.map((parent1) => ({
    id: parent1.id,
    name: parent1.name,
    organization_id: parent1.organization_id,
    description: parent1.description,
    price: parent1.price,
    due_date: parent1.due_date,
    image_url: parent1.image_url,
    creator_id: parent1.creator_id,
    organization: parent1.organization,
  }));
}

export async function getParent1Detail(id: string, userId: string): Promise<Parent1Detail | null> {
  const associatedOrganizations = await getAssociatedOrganizations(userId);
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);
  const parent1 = await prisma.parent1.findFirst({
    where: {
      id,
      organization_id: { in: associatedOrganizationIds },
    },
    include: {
      parent1_child1s: true, parent1_child2s: true, parent1_lists: true, organization: true
    },
  });

  if (!parent1) {
    return null;
  }

  return {
    ...parent1,
  };
}

export async function getParent1ListPageData(isAssertPermission: boolean = true) {
  const userId = await getSessionUserIdOrThrow();
  const [{ permissions: userPermissions }, parent1s] = await Promise.all([
    getModelPermissions('parent1', userId),
    getAllParent1s(userId),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'parent1');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredParent1s = userPermissions.general.read
    ? parent1s
    : parent1s.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { parent1s: filteredParent1s, userPermissions: await toPermissions(userPermissions) };
}

export async function getParent1DetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const [parent1, { permissions: basePermissions }] = await Promise.all([
    getParent1Detail(id, userId),
    getModelPermissions('parent1', userId),
  ]);
  const resolved = await resolvePermissions(basePermissions, parent1, userId ?? '');
  await assertPermission(resolved, operation, 'parent1');
  return { parent1, userPermissions: await toPermissions(resolved) };
}

export async function getParent1NewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('parent1');
  await assertPermission(richPermissions.general, 'create', 'parent1');
  return richPermissions.general;
}
