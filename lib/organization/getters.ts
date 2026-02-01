'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';

export async function getAllOrganizations(): Promise<Organization[]> {
  const organizations = await prisma.organization.findMany();
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
  }));
}

export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: { id },
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
