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
  const organization_id = data.get('organization_id') as string;
  const description = data.get('description') as string | null;
  const price = Number(data.get('price'));
  const due_date_str = data.get('due_date') as string;
  const due_date = new Date(due_date_str);
  const image_url = data.get('image_url') as string | null;
  const parent1Child1sRaw = data.getAll('parent1Child1[]') as string[];
  const parent1Child1s = parent1Child1sRaw.map(f => JSON.parse(f) as { id?: string; order: number; name: string; type: string; parent1_id?: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const parent1Child2sRaw = data.getAll('parent1Child2[]') as string[];
  const parent1Child2s = parent1Child2sRaw.map(f => JSON.parse(f) as { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date });
  const parent1ListsRaw = data.getAll('parent1List[]') as string[];
  const parent1Lists = parent1ListsRaw.map(f => JSON.parse(f) as { id?: string; name: string });

  if (id) {
    await updateParent1(id, name, organization_id, description, price, due_date, image_url, parent1Child1s, parent1Child2s, parent1Lists);
  } else {
    await addParent1(name, organization_id, description, price, due_date, image_url, parent1Child1s, parent1Child2s, parent1Lists);
  }

  revalidatePath('/');
  redirect('/parent1');
}

async function addParent1(name: string, organization_id: string, description: string | null, price: number, due_date: Date, image_url: string | null, parent1Child1s: { order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2s: { name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1Lists: { name: string }[]) {
  await prisma.parent1.create({
    data: {
      name,
      organization_id,
      description,
      price,
      due_date,
      image_url,
      parent1_child1s: {
        create: parent1Child1s.map(f => ({
          order: f.order,
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
      parent1_child2s: {
        create: parent1Child2s.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        create: parent1Lists.map(f => ({
          name: f.name,
        })),
      },
    },
  });
}

async function updateParent1(id: string, name: string, organization_id: string, description: string | null, price: number, due_date: Date, image_url: string | null, parent1Child1s: { id?: string; order: number; name: string; type: string; parent1_id?: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2s: { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1Lists: { id?: string; name: string }[]) {
  await prisma.parent1.update({
    where: { id },
    data: {
      name,
      organization_id,
      description,
      price,
      due_date,
      image_url,
      parent1_child1s: {
        deleteMany: {},
        create: parent1Child1s.map(f => ({
          order: f.order,
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
      parent1_child2s: {
        deleteMany: {},
        create: parent1Child2s.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        deleteMany: {},
        create: parent1Lists.map(f => ({
          name: f.name,
        })),
      },
    },
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
