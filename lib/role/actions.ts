'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertRole(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const userAccountsRaw = data.getAll('userAccount[]') as string[];
  const userAccounts = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name: string; email: string; password: string; api_key: string | null; avatar: string | null });

  if (id) {
    await updateRole(id, name, description, userAccounts);
  } else {
    await addRole(name, description, userAccounts);
  }

  revalidatePath('/');
  redirect('/role');
}

async function addRole(name: string, description: string | null, userAccounts: { name: string; email: string; password: string; api_key: string | null; avatar: string | null }[]) {
  await prisma.role.create({
    data: {
      name,
      description,
      user_accounts: {
        create: userAccounts.map(f => ({
          name: f.name,
          email: f.email,
          password: f.password,
          api_key: f.api_key,
          avatar: f.avatar,
        })),
      },
    },
  });
}

async function updateRole(id: string, name: string, description: string | null, userAccounts: { id?: string; name: string; email: string; password: string; api_key: string | null; avatar: string | null }[]) {
  await prisma.role.update({
    where: { id },
    data: {
      name,
      description,
      user_accounts: {
        deleteMany: {},
        create: userAccounts.map(f => ({
          name: f.name,
          email: f.email,
          password: f.password,
          api_key: f.api_key,
          avatar: f.avatar,
        })),
      },
    },
  });
}

export async function removeRole(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  if (Array.isArray(data)) {
    await prisma.role.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.role.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/role');
}
