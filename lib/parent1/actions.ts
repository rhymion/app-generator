'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertParent1(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const price = Number(data.get('price'));
  const due_date_str = data.get('due_date') as string;
  const due_date = new Date(due_date_str);
  const image_url = data.get('image_url') as string | null;
  const parent1Child1sRaw = data.getAll('parent1Child1[]') as string[];
  const parent1Child1s = parent1Child1sRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; parent1_id?: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const parent1Child2sRaw = data.getAll('parent1Child2[]') as string[];
  const parent1Child2s = parent1Child2sRaw.map(f => JSON.parse(f) as { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date });

  if (id) {
    await updateParent1(id, name, description, price, due_date, image_url, parent1Child1s, parent1Child2s);
  } else {
    await addParent1(name, description, price, due_date, image_url, parent1Child1s, parent1Child2s);
  }

  revalidatePath('/');
  redirect('/parent1');
}

async function addParent1(name: string, description: string | null, price: number, due_date: Date, image_url: string | null, parent1Child1s: { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2s: { name: string; required: boolean; start_date: Date | null; end_date: Date }[]) {
  await prisma.$transaction(async (tx) => {
    const newRecord = await tx.parent1.create({
      data: {
      name,
      description,
      price,
      due_date,
      image_url,
      },
    });
    const recordId = newRecord.id;

    if (parent1Child1s.length > 0) {
      await tx.parent1_child1.createMany({
        data: parent1Child1s.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
          parent1_id: recordId,
        })),
      });
    }
    if (parent1Child2s.length > 0) {
      await tx.parent1_child2.createMany({
        data: parent1Child2s.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
          parent1_id: recordId,
        })),
      });
    }
  });
}

async function updateParent1(id: string, name: string, description: string | null, price: number, due_date: Date, image_url: string | null, parent1Child1s: { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2s: { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date }[]) {
  await prisma.$transaction(async (tx) => {
    await tx.parent1.update({
      where: { id },
      data: {
      name,
      description,
      price,
      due_date,
      image_url,
      },
    });

    const existingParent1Child1 = await tx.parent1_child1.findMany({
      where: { parent1_id: id },
    });

    const parent1Child1ToUpsert = parent1Child1s.filter(f => f.id);
    const parent1Child1ToCreate = parent1Child1s.filter(f => !f.id);

    for (const item of parent1Child1ToUpsert) {
      await tx.parent1_child1.update({
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

    if (parent1Child1ToCreate.length > 0) {
      await tx.parent1_child1.createMany({
        data: parent1Child1ToCreate.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
          parent1_id: id,
        })),
      });
    }

    const parent1Child1NewIds = parent1Child1s.filter(f => f.id).map(f => f.id!);
    const parent1Child1ToDelete = existingParent1Child1.filter(ef => !parent1Child1NewIds.includes(ef.id));
    if (parent1Child1ToDelete.length > 0) {
      await tx.parent1_child1.deleteMany({
        where: { id: { in: parent1Child1ToDelete.map(f => f.id) } },
      });
    }

    const existingParent1Child2 = await tx.parent1_child2.findMany({
      where: { parent1_id: id },
    });

    const parent1Child2ToUpsert = parent1Child2s.filter(f => f.id);
    const parent1Child2ToCreate = parent1Child2s.filter(f => !f.id);

    for (const item of parent1Child2ToUpsert) {
      await tx.parent1_child2.update({
        where: { id: item.id! },
        data: {
          name: item.name,
          required: item.required,
          start_date: item.start_date,
          end_date: item.end_date,
        },
      });
    }

    if (parent1Child2ToCreate.length > 0) {
      await tx.parent1_child2.createMany({
        data: parent1Child2ToCreate.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
          parent1_id: id,
        })),
      });
    }

    const parent1Child2NewIds = parent1Child2s.filter(f => f.id).map(f => f.id!);
    const parent1Child2ToDelete = existingParent1Child2.filter(ef => !parent1Child2NewIds.includes(ef.id));
    if (parent1Child2ToDelete.length > 0) {
      await tx.parent1_child2.deleteMany({
        where: { id: { in: parent1Child2ToDelete.map(f => f.id) } },
      });
    }
  });
}

export async function removeParent1(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  if (Array.isArray(data)) {
    await prisma.parent1.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.parent1.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/parent1');
}
