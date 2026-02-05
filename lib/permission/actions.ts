'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertPermission(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('permission', 'update');
  } else {
    await requirePermission('permission', 'create');
  }
  const name = data.get('name') as string;
  const create = data.get('create') === 'true';
  const read = data.get('read') === 'true';
  const update = data.get('update') === 'true';
  const deleteValue = data.get('delete') === 'true';
  const roleId = (data.get('role_id') as string | null) || null;

  if (id) {
    await updatePermission(id, name, create, read, update, deleteValue, roleId);
  } else {
    await addPermission(name, create, read, update, deleteValue, roleId);
  }

  revalidatePath('/');
  redirect('/permission');
}

async function addPermission(name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null) {
  await prisma.permission.create({
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    },
  });
}

async function updatePermission(id: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null) {
  await prisma.permission.update({
    where: { id },
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    },
  });
}

export async function removePermission(data: FormData | string[]) {
  await requirePermission('permission', 'delete');

  if (Array.isArray(data)) {
    await prisma.permission.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.permission.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/permission');
}
