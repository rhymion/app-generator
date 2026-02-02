'use server';

import prisma from '@/lib/prisma';
import type { ParentOnly, ParentOnlyDetail } from '@/lib/parent_only/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function getAllParentOnlys(): Promise<ParentOnly[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const parentOnlys = await prisma.parent_only.findMany({
  });
  return parentOnlys.map((parentOnly) => ({
    id: parentOnly.id,
    name: parentOnly.name,
    description: parentOnly.description,
    login_time: parentOnly.login_time,
    logout_time: parentOnly.logout_time,
  }));
}

export async function getParentOnlyDetail(id: string): Promise<ParentOnlyDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const parentOnly = await prisma.parent_only.findUnique({
    where: { 
      id,
    },
  });

  if (!parentOnly) {
    return null;
  }

  return {
    ...parentOnly,
  };
}
