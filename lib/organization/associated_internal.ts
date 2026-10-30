// Plain internal module (no module-level directive on purpose): these helpers
// take the user id as a parameter and are meant to be called only by callers
// that have already resolved it from the session. Keep them out of the
// server-function module in getters_associated.ts.
import prisma from '@/lib/prisma';
import type { Organization, OrganizationDetail } from '@/lib/organization/types';

export async function getAssociatedOrganizations(userId: string): Promise<Organization[]> {
  const organizations = await prisma.organization.findMany({
    where: {
      users: {
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
      users: {
        some: {
          id: userId
        }
      }
    },
    include: { 
      users: {
        where: { id: userId }
      }
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
    users: organization.users,
  };
}
