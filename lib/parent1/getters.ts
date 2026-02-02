'use server';

import prisma from '@/lib/prisma';
import type { Parent1, Parent1Detail } from '@/lib/parent1/types';
import { authOptions } from '@/auth';
import { getServerSession } from 'next-auth';

export async function getAllParent1s(): Promise<Parent1[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const parent1s = await prisma.parent1.findMany({
    where: {
      organization: {
        user_accounts: {
          some: {
            id: session.user.id
          }
        }
      }
    }
  });
  return parent1s.map((parent1) => ({
    id: parent1.id,
    name: parent1.name,
    organization_id: parent1.organization_id,
    description: parent1.description,
    price: parent1.price,
    due_date: parent1.due_date,
    image_url: parent1.image_url,
  }));
}

export async function getParent1Detail(id: string): Promise<Parent1Detail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }
  const parent1 = await prisma.parent1.findUnique({
    where: { 
      id,
      organization: {
        user_accounts: {
          some: {
            id: session.user.id
          }
        }
      }
    },
    include: { 
      organization: true,
      parent1_child1s: true, 
      parent1_child2s: true, 
      parent1_lists: true,
    },
  });

  if (!parent1) {
    return null;
  }

  return {
    ...parent1,
    organization: parent1.organization,
    parent1_child1s: parent1.parent1_child1s,
    parent1_child2s: parent1.parent1_child2s,
    parent1_lists: parent1.parent1_lists,
  };
}
