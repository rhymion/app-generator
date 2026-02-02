'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function getAllOrganizations(): Promise<Organization[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const organizations = await prisma.organization.findMany({
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    description: organization.description,
  }));
}

export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

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
