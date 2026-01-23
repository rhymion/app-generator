'use server';

import prisma from '@/lib/prisma';
import type { XxxxxXxxxx, XxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/types';

export async function getAllXxxxxXxxxxs(): Promise<XxxxxXxxxx[]> {
  const xxxxxXxxxxs = await prisma.xxxxx_xxxxx.findMany();
  return xxxxxXxxxxs.map((xxxxxXxxxx) => ({
    id: xxxxxXxxxx.id,
    name: xxxxxXxxxx.name,
    description: xxxxxXxxxx.description,
    team: xxxxxXxxxx.team,
  }));
}

export async function getXxxxxXxxxxDetail(id: string): Promise<XxxxxXxxxxDetail | null> {
  const xxxxxXxxxx = await prisma.xxxxx_xxxxx.findUnique({
    where: { id },
    include: { yyyyyYyyyy: true },
  });

  if (!xxxxxXxxxx) {
    return null;
  }

  return {
    id: xxxxxXxxxx.id,
    name: xxxxxXxxxx.name,
    description: xxxxxXxxxx.description,
    team: xxxxxXxxxx.team,
    yyyyyYyyyy: xxxxxXxxxx.yyyyyYyyyy.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      xxxxx_xxxxx_id: item.xxxxx_xxxxx_id,
      max_length: item.max_length,
      max: item.max,
      regex: item.regex,
      required: item.required,
      written_by: item.written_by,
    })),
  };
}
