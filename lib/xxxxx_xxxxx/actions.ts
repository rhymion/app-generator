'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertXxxxxXxxxx(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('xxxxx_xxxxx', 'update');
  } else {
    await requirePermission('xxxxx_xxxxx', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const team = data.get('team') as string | null;
  const yyyyyYyyyysRaw = data.getAll('yyyyy_yyyyy[]') as string[];
  const yyyyyYyyyysItems = yyyyyYyyyysRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });

  if (id) {
    await updateXxxxxXxxxx(id, name, description, team, yyyyyYyyyysItems);
  } else {
    await addXxxxxXxxxx(name, description, team, yyyyyYyyyysItems);
  }

  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}

async function addXxxxxXxxxx(name: string, description: string | null, team: string | null, yyyyyYyyyysItems: { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  await prisma.xxxxx_xxxxx.create({
    data: {
      name: name,
      description: description,
      team: team,
      yyyyy_yyyyys: {
        create: yyyyyYyyyysItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
    },
  });
}

async function updateXxxxxXxxxx(id: string, name: string, description: string | null, team: string | null, yyyyyYyyyysItems: { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  await prisma.xxxxx_xxxxx.update({
    where: { id },
    data: {
      name: name,
      description: description,
      team: team,
      yyyyy_yyyyys: {
        deleteMany: {},
        create: yyyyyYyyyysItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
    },
  });
}

export async function removeXxxxxXxxxx(data: FormData | string[]) {
  await requirePermission('xxxxx_xxxxx', 'delete');

  if (Array.isArray(data)) {
    await prisma.xxxxx_xxxxx.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.xxxxx_xxxxx.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}
