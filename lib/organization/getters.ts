'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

async function getAllOrganizations(): Promise<Organization[]> {

  const organizations = await prisma.organization.findMany({
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
  }));
}

async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  
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
    user_accounts: organization.user_accounts,
  };
}

export async function getOrganizationListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('organization');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'organization');
  }
  const organizations = await getAllOrganizations();
  return { organizations, userPermissions };
}

export async function getOrganizationDetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('organization');
  await assertPermission(userPermissions, operation, 'organization');
  const organization = await getOrganizationDetail(id);
  return { organization, userPermissions };
}

export async function getOrganizationNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('organization');
  await assertPermission(userPermissions, 'create', 'organization');
  return userPermissions;
}
