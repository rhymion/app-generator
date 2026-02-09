'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertUserAccount(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('user_account', 'update');
  } else {
    await requirePermission('user_account', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const rolesItems = rolesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const rolesIds = rolesItems
    .map((role) => role.id)
    .filter((roleId): roleId is string => Boolean(roleId));


  if (id) {
    await updateUserAccount(id, name, email, password, apiKey, avatar, rolesIds);
  } else {
    await addUserAccount(name, email, password, apiKey, avatar, rolesIds);
  }

  revalidatePath('/');
  redirect('/user_account');
}

async function addUserAccount(name: string, email: string, password: string, apiKey: string | null, avatar: string | null, rolesIds: string[]) {
  await prisma.user_account.create({
    data: {
      name: name,
      email: email,
      password: password,
      api_key: apiKey,
      avatar: avatar,
      roles: {
        connect: rolesIds.map((id) => ({ id })),
      },
    },
  });
}

async function updateUserAccount(id: string, name: string, email: string, password: string, apiKey: string | null, avatar: string | null, rolesIds: string[]) {
  await prisma.user_account.update({
    where: { id },
    data: {
      name: name,
      email: email,
      password: password,
      api_key: apiKey,
      avatar: avatar,
      roles: {
        set: rolesIds.map((id) => ({ id })),
      },
    },
  });
}

export async function removeUserAccount(data: FormData | string[]) {
  await requirePermission('user_account', 'delete');

  if (Array.isArray(data)) {
    await prisma.user_account.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.user_account.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/user_account');
}
