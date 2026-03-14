'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { authOptions } from '@/auth';
import { getServerSession } from 'next-auth';
import { assertPermission, getModelPermissions, getSessionUserIdOrThrow, Operation, resolvePermissions, toPermissions } from '../authz';

export async function getAssociatedOrganizations(userId: string): Promise<Organization[]> {
  const organizations = await prisma.organization.findMany({
    where: {
      user_accounts: {
        some: {
          id: userId
        }
      }
    },
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    creator_id: organization.creator_id,
  }));
}

export async function getAssociatedOrganizationDetail(id: string, userId: string): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: { 
      id,
      user_accounts: {
        some: {
          id: userId
        }
      }
    },
    include: { 
      user_accounts: {
        where: { id: userId }
      }
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
    user_accounts: organization.user_accounts,
  };
}

export async function getAssociatedOrganizationListPageData(isAssertPermission: boolean = true) {
  const userId = await getSessionUserIdOrThrow();
  const [{ permissions: userPermissions }, organizations] = await Promise.all([
    getModelPermissions('organization', userId),
    getAssociatedOrganizations(userId),
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

export async function getAssociatedOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const [organization, { permissions: basePermissions }] = await Promise.all([
    getAssociatedOrganizationDetail(id, userId),
    getModelPermissions('organization', userId),
  ]);
  const resolved = await resolvePermissions(basePermissions, organization, userId ?? '');
  await assertPermission(resolved, operation, 'organization');
  return { organization, userPermissions: await toPermissions(resolved) };
}
