'use server';

import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';
import { authOptions } from '@/auth';
import { getServerSession } from 'next-auth';

export async function getAssociatedOrganizations(): Promise<Organization[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const organizations = await prisma.organization.findMany({
    where: {
      user_accounts: {
        some: {
          id: session.user.id
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

export async function getAssociatedOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const organization = await prisma.organization.findUnique({
    where: { 
      id,
      user_accounts: {
        some: {
          id: session.user.id
        }
      }
    },
    include: { 
      user_accounts: {
        where: { id: session.user.id }
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
