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
  const loginTimeStr = data.get('login_time') as string | null;
  const loginTime = loginTimeStr ? new Date(loginTimeStr) : null;
  const logoutTimeStr = data.get('logout_time') as string | null;
  const logoutTime = logoutTimeStr ? new Date(logoutTimeStr) : null;

  if (id) {
    await updateParentOnly(id, name, description, loginTime, logoutTime);
  } else {
    await addParentOnly(name, description, loginTime, logoutTime);
  }

  revalidatePath('/');
  redirect('/parent_only');
}

async function addParentOnly(name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null) {
  await prisma.parent_only.create({
    data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
    },
  });
}

async function updateParentOnly(id: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null) {
  await prisma.parent_only.update({
    where: { id },
    data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
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
