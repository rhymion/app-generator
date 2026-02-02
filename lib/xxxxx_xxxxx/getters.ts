'use server';

import prisma from '@/lib/prisma';
import type { XxxxxXxxxx, XxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function getAllXxxxxXxxxxs(): Promise<XxxxxXxxxx[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const xxxxxXxxxxs = await prisma.xxxxx_xxxxx.findMany({
  });
  return xxxxxXxxxxs.map((xxxxxXxxxx) => ({
    id: xxxxxXxxxx.id,
    name: xxxxxXxxxx.name,
    description: xxxxxXxxxx.description,
    team: xxxxxXxxxx.team,
  }));
}

export async function getXxxxxXxxxxDetail(id: string): Promise<XxxxxXxxxxDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const xxxxxXxxxx = await prisma.xxxxx_xxxxx.findUnique({
    where: { 
      id,
    },
    include: { 
      yyyyy_yyyyys: true 
    },
  });

  if (!xxxxxXxxxx) {
    return null;
  }

  return {
    ...xxxxxXxxxx,
    yyyyy_yyyyys: xxxxxXxxxx.yyyyy_yyyyys,
  };
}
