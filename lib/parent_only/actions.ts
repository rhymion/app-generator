'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsertParentOnly(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const login_time_str = data.get('login_time') as string | null;
  const login_time = login_time_str ? new Date(login_time_str) : null;
  const logout_time_str = data.get('logout_time') as string | null;
  const logout_time = logout_time_str ? new Date(logout_time_str) : null;

  if (id) {
    await updateParentOnly(id, name, description, login_time, logout_time);
  } else {
    await addParentOnly(name, description, login_time, logout_time);
  }

  revalidatePath('/');
  redirect('/parent_only');
}

async function addParentOnly(name: string, description: string | null, login_time: Date | null, logout_time: Date | null) {
  await prisma.parent_only.create({
    data: {
      name,
      description,
      login_time,
      logout_time,
    },
  });
}

async function updateParentOnly(id: string, name: string, description: string | null, login_time: Date | null, logout_time: Date | null) {
  await prisma.parent_only.update({
    where: { id },
    data: {
      name,
      description,
      login_time,
      logout_time,
    },
  });
}

export async function removeParentOnly(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  if (Array.isArray(data)) {
    await prisma.parent_only.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.parent_only.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/parent_only');
}
