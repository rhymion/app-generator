'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { authOptions } from '@/auth';
import { getServerSession } from 'next-auth';
import { assertPermission, getModelPermissions, getSessionUserIdOrThrow, Operation } from '../authz';

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
  const userPermissions = await getModelPermissions('organization', userId);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'organization');
  }
  const organizations = await getAssociatedOrganizations(userId);
  return { organizations, userPermissions };
}

export async function getAssociatedOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const userId = await getSessionUserIdOrThrow();
  const userPermissions = await getModelPermissions('organization', userId);
  await assertPermission(userPermissions, operation, 'organization');
  const organization = await getAssociatedOrganizationDetail(id, userId);
  return { organization, userPermissions };
}
