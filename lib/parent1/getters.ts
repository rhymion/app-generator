'use server';

import prisma from '@/lib/prisma';
import type { Parent1, Parent1Detail } from '@/lib/parent1/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export async function getAllParent1s(): Promise<Parent1[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const associatedOrganizations = await getAssociatedOrganizations();
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

export async function getParent1Detail(id: string): Promise<Parent1Detail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const associatedOrganizations = await getAssociatedOrganizations();
  const associatedOrganizationIds = associatedOrganizations.map((organization) => organization.id);

  const parent1 = await prisma.parent1.findFirst({
    where: { 
      id,
      organization_id: { in: associatedOrganizationIds },
    },
    include: { 
      parent1_child1s: true, 
      parent1_child2s: true, 
      parent1_lists: true, 
      organization: true 
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
