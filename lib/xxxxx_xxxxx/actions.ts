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
  const yyyyyYyyyysRaw = data.getAll('yyyyyYyyyy[]') as string[];
  const yyyyyYyyyys = yyyyyYyyyysRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; xxxxx_xxxxx_id?: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });

  if (id) {
    await updateXxxxxXxxxx(id, name, description, team, yyyyyYyyyys);
  } else {
    await addXxxxxXxxxx(name, description, team, yyyyyYyyyys);
  }

  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}

async function addXxxxxXxxxx(name: string, description: string | null, team: string | null, yyyyyYyyyys: { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  await prisma.$transaction(async (tx) => {
    const newRecord = await tx.xxxxx_xxxxx.create({
      data: {
      name,
      description,
      team,
      },
    });
    const recordId = newRecord.id;

    if (yyyyyYyyyys.length > 0) {
      await tx.yyyyy_yyyyy.createMany({
        data: yyyyyYyyyys.map(f => ({
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

async function updateXxxxxXxxxx(id: string, name: string, description: string | null, team: string | null, yyyyyYyyyys: { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
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

    const yyyyyYyyyyToUpsert = yyyyyYyyyys.filter(f => f.id);
    const yyyyyYyyyyToCreate = yyyyyYyyyys.filter(f => !f.id);

    for (const item of yyyyyYyyyyToUpsert) {
      await tx.yyyyy_yyyyy.update({
        where: { id: item.id! },
        data: {
          name: item.name,
          type: item.type,
          max_length: item.max_length,
          max: item.max,
          regex: item.regex,
          required: item.required,
          written_by: item.written_by,
        },
      });
    }

    if (yyyyyYyyyyToCreate.length > 0) {
      await tx.yyyyy_yyyyy.createMany({
        data: yyyyyYyyyyToCreate.map(f => ({
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

    const yyyyyYyyyyNewIds = yyyyyYyyyys.filter(f => f.id).map(f => f.id!);
    const yyyyyYyyyyToDelete = existingYyyyyYyyyy.filter(ef => !yyyyyYyyyyNewIds.includes(ef.id));
    if (yyyyyYyyyyToDelete.length > 0) {
      await tx.yyyyy_yyyyy.deleteMany({
        where: { id: { in: yyyyyYyyyyToDelete.map(f => f.id) } },
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
