'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertParent1(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('parent1', 'update');
  } else {
    await requirePermission('parent1', 'create');
  }
  const name = data.get('name') as string;
  const organizationId = data.get('organization_id') as string;
  const description = data.get('description') as string | null;
  const price = Number(data.get('price'));
  const dueDateStr = data.get('due_date') as string;
  const dueDate = new Date(dueDateStr);
  const imageUrl = data.get('image_url') as string | null;
  const parent1Child1sRaw = data.getAll('parent1_child1[]') as string[];
  const parent1Child1sItems = parent1Child1sRaw.map(f => JSON.parse(f) as { id?: string; order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const parent1Child2sRaw = data.getAll('parent1_child2[]') as string[];
  const parent1Child2sItems = parent1Child2sRaw.map(f => JSON.parse(f) as { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date });
  const parent1ListsRaw = data.getAll('parent1_list[]') as string[];
  const parent1ListsItems = parent1ListsRaw.map(f => JSON.parse(f) as { id?: string; name: string });


  if (id) {
    await updateParent1(id, name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems);
  } else {
    await addParent1(name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems);
  }

  revalidatePath('/');
  redirect('/parent1');
}

async function addParent1(name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { name: string }[]) {
  await prisma.parent1.create({
    data: {
      name: name,
      organization_id: organizationId,
      description: description,
      price: price,
      due_date: dueDate,
      image_url: imageUrl,
      parent1_child1s: {
        create: parent1Child1sItems.map(f => ({
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
        create: parent1Child2sItems.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        create: parent1ListsItems.map(f => ({
          name: f.name,
        })),
      },
    },
  });
}

async function updateParent1(id: string, name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { id?: string; order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { id?: string; name: string }[]) {
  await prisma.parent1.update({
    where: { id },
    data: {
      name: name,
      organization_id: organizationId,
      description: description,
      price: price,
      due_date: dueDate,
      image_url: imageUrl,
      parent1_child1s: {
        deleteMany: {},
        create: parent1Child1sItems.map(f => ({
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
        create: parent1Child2sItems.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        deleteMany: {},
        create: parent1ListsItems.map(f => ({
          name: f.name,
        })),
      },
    },
  });
}

export async function removeParent1(data: FormData | string[]) {
  await requirePermission('parent1', 'delete');

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
