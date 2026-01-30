'use server';

import prisma from '@/lib/prisma';
import type { ParentOnly, ParentOnlyDetail } from '@/lib/parent_only/types';

export async function getAllParentOnlys(): Promise<ParentOnly[]> {
  const parentOnlys = await prisma.parent_only.findMany();
  return parentOnlys.map((parentOnly) => ({
    id: parentOnly.id,
    name: parentOnly.name,
    description: parentOnly.description,
    login_time: parentOnly.login_time,
    logout_time: parentOnly.logout_time,
  }));
}

export async function getParentOnlyDetail(id: string): Promise<ParentOnlyDetail | null> {
  const parentOnly = await prisma.parent_only.findUnique({
    where: { id },
  });

  if (!parentOnly) {
    return null;
  }

  return {
    ...parentOnly,
  };
}
