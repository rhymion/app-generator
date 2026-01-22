'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertDbTable(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const fieldsRaw = data.getAll('fields[]') as string[];
  const fields = fieldsRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string;table_id?: string; max_length?: number | null; max?: number | null; regex?: string | null; required: boolean });

  if (id) {
    await updateDbTable(id, name, description, fields);
  } else {
    await addDbTable(name, description, fields);
  }

  revalidatePath('/');
  redirect('/db_table');
}

async function addDbTable(name: string, description: string | null, fields: { name: string; type: string; max_length?: number | null; max?: number | null; regex?: string | null; required: boolean }[]) {
  await prisma.$transaction(async (tx) => {
    const newTable = await tx.db_table.create({
      data: { name, description },
    });
    const tableId = newTable.id;

    if (fields.length > 0) {
      await tx.field.createMany({
        data: fields.map(f => ({
          name: f.name,
          type: f.type,
          table_id: tableId,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      });
    }
  });
}

async function updateDbTable(id: string, name: string, description: string | null, fields: { id?: string; name: string; type: string; max_length?: number | null; max?: number | null; regex?: string | null; required: boolean }[]) {
  await prisma.$transaction(async (tx) => {
    // Update db_table
    await tx.db_table.update({
      where: { id },
      data: { name, description },
    });

    // Get existing fields
    const existingFields = await tx.field.findMany({
      where: { table_id: id },
    });

    // Fields to update or create
    const fieldsToUpsert = fields.filter(f => f.id);
    const fieldsToCreate = fields.filter(f => !f.id);

    // Update existing fields
    for (const field of fieldsToUpsert) {
      await tx.field.update({
        where: { id: field.id! },
        data: {
          name: field.name,
          max_length: field.max_length,
          max: field.max,
          regex: field.regex,
          required: field.required,
        },
      });
    }

    // Create new fields
    if (fieldsToCreate.length > 0) {
      await tx.field.createMany({
        data: fieldsToCreate.map(f => ({
          name: f.name,
          type: f.type,
          table_id: id,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      });
    }

    // Delete fields not in the new list
    const newFieldIds = fields.filter(f => f.id).map(f => f.id!);
    const fieldsToDelete = existingFields.filter(ef => !newFieldIds.includes(ef.id));
    if (fieldsToDelete.length > 0) {
      await tx.field.deleteMany({
        where: { id: { in: fieldsToDelete.map(f => f.id) } },
      });
    }
  });
}

export async function removeDbTable(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  if (Array.isArray(data)) {
    await prisma.db_table.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.db_table.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/db_table');
}
