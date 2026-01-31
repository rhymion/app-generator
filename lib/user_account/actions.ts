'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertUserAccount(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const api_key = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const roles = rolesRaw.map(f => JSON.parse(f) as { id?: string; name: string; description: string | null });

  if (id) {
    await updateUserAccount(id, name, email, password, api_key, avatar, roles);
  } else {
    await addUserAccount(name, email, password, api_key, avatar, roles);
  }

  revalidatePath('/');
  redirect('/user_account');
}

async function addUserAccount(name: string, email: string, password: string, api_key: string | null, avatar: string | null, roles: { name: string; description: string | null }[]) {
  await prisma.user_account.create({
    data: {
      name,
      email,
      password,
      api_key,
      avatar,
      roles: {
        create: roles.map(f => ({
          name: f.name,
          description: f.description,
        })),
      },
    },
  });
}

async function updateUserAccount(id: string, name: string, email: string, password: string, api_key: string | null, avatar: string | null, roles: { id?: string; name: string; description: string | null }[]) {
  await prisma.user_account.update({
    where: { id },
    data: {
      name,
      email,
      password,
      api_key,
      avatar,
      roles: {
        deleteMany: {},
        create: roles.map(f => ({
          name: f.name,
          description: f.description,
        })),
      },
    },
  });
}

export async function removeUserAccount(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

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
