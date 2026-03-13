'use server';

import prisma from '@/lib/prisma';
import type { Parent1, Parent1Detail } from '@/lib/parent1/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions, getSessionUserIdOrThrow } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';
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
      parent1_child1s: true, parent1_child2s: true, parent1_lists: true, organization: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!parent1) {
    return null;
  }

  return {
    ...parent1,
    parent1_child1s: parent1.parent1_child1s,
    parent1_child2s: parent1.parent1_child2s,
    parent1_lists: parent1.parent1_lists,
    organization: parent1.organization,
  };
}

export async function getParent1ListPageData(isAssertPermission: boolean = true) {
  const userId = await getSessionUserIdOrThrow();
  const [userPermissions, parent1s] = await Promise.all([
    getModelPermissions('parent1', userId),
    getAllParent1s(userId),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'parent1');
  }
  return { parent1s, userPermissions };
}

export async function getParent1DetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const parent1 = await getParent1Detail(id, userId);
  const userPermissions = await getModelPermissions('parent1', userId, parent1);
  await assertPermission(userPermissions, operation, 'parent1');
  return { parent1, userPermissions };
}

export async function getParent1NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('parent1');
  await assertPermission(userPermissions, 'create', 'parent1');
  return userPermissions;
}
