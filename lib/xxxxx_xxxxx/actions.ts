'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertXxxxxXxxxx(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const team = data.get('team') as string | null;
  const yyyyyYyyyyRaw = data.getAll('yyyyyYyyyy[]') as string[];
  const yyyyyYyyyy = yyyyyYyyyyRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });

  if (id) {
    await updateXxxxxXxxxx(id, name, description, team, yyyyyYyyyy);
  } else {
    await addXxxxxXxxxx(name, description, team, yyyyyYyyyy);
  }

  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}

async function addXxxxxXxxxx(name: string, description: string | null, team: string | null, yyyyyYyyyy: { name: string; type: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  await prisma.$transaction(async (tx) => {
    const newRecord = await tx.xxxxx_xxxxx.create({
      data: {
      name,
      description,
      team,
      },
    });
    const recordId = newRecord.id;

    if (yyyyyYyyyy.length > 0) {
      await tx.yyyyy_yyyyy.createMany({
        data: yyyyyYyyyy.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
          xxxxx_xxxxx_id: recordId,
        })),
      });
    }
  });
}

async function updateXxxxxXxxxx(id: string, name: string, description: string | null, team: string | null, yyyyyYyyyy: { id?: string; name: string; type: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  await prisma.$transaction(async (tx) => {
    await tx.xxxxx_xxxxx.update({
      where: { id },
      data: {
      name,
      description,
      team,
      },
    });

    const existingYyyyyYyyyy = await tx.yyyyy_yyyyy.findMany({
      where: { xxxxx_xxxxx_id: id },
    });

    const toUpsert = yyyyyYyyyy.filter(f => f.id);
    const toCreate = yyyyyYyyyy.filter(f => !f.id);

    for (const item of toUpsert) {
      await tx.yyyyy_yyyyy.update({
        where: { id: item.id! },
        data: {
          name: field.name,
          type: field.type,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
          written_by: field.written_by,
        },
      });
    }

    if (toCreate.length > 0) {
      await tx.yyyyy_yyyyy.createMany({
        data: toCreate.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
          xxxxx_xxxxx_id: id,
        })),
      });
    }

    const newIds = yyyyyYyyyy.filter(f => f.id).map(f => f.id!);
    const toDelete = existingYyyyyYyyyy.filter(ef => !newIds.includes(ef.id));
    if (toDelete.length > 0) {
      await tx.yyyyy_yyyyy.deleteMany({
        where: { id: { in: toDelete.map(f => f.id) } },
      });
    }
  });
}

export async function removeXxxxxXxxxx(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

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
