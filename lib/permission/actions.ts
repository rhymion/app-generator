'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertPermission(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const create = data.get('create') === 'true';
  const read = data.get('read') === 'true';
  const update = data.get('update') === 'true';
  const remove = data.get('remove') === 'true';
  const roleId = data.get('role_id') as string | null;

  if (id) {
    await updatePermission(id, name, create, read, update, remove, roleId);
  } else {
    await addPermission(name, create, read, update, remove, roleId);
  }

  revalidatePath('/');
  redirect('/permission');
}

async function addPermission(name: string, create: boolean, read: boolean, update: boolean, remove: boolean, roleId: string | null) {
  await prisma.permission.create({
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      remove: remove,
      role_id: roleId,
    },
  });
}

async function updatePermission(id: string, name: string, create: boolean, read: boolean, update: boolean, remove: boolean, roleId: string | null) {
  await prisma.permission.update({
    where: { id },
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      remove: remove,
      role_id: roleId,
    },
  });
}

export async function removePermission(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

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
