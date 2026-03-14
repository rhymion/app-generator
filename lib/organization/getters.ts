'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllOrganizations(): Promise<Organization[]> {
  const organizations = await prisma.organization.findMany({
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
}

export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: {
      id,
    },
    include: {
      user_accounts: true
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
  };
}

export async function getOrganizationListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, organizations] = await Promise.all([
    getModelPermissions('organization'),
    getAllOrganizations(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'organization');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredOrganizations = userPermissions.general.read
    ? organizations
    : organizations.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { organizations: filteredOrganizations, userPermissions: await toPermissions(userPermissions) };
}

export async function getOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const [organization, { permissions: basePermissions, userId }] = await Promise.all([
    getOrganizationDetail(id),
    getModelPermissions('organization'),
  ]);
  const resolved = await resolvePermissions(basePermissions, organization, userId ?? '');
  await assertPermission(resolved, operation, 'organization');
  return { organization, userPermissions: await toPermissions(resolved) };
}

export async function getOrganizationNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('organization');
  await assertPermission(richPermissions.general, 'create', 'organization');
  return richPermissions.general;
}
