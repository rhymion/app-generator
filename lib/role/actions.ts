'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertRole(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('role', 'update');
  } else {
    await requirePermission('role', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const userAccountsRaw = data.getAll('user_account[]') as string[];
  const userAccountsItems = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const userAccountsIds = userAccountsItems
    .map((userAccount) => userAccount.id)
    .filter((userAccountId): userAccountId is string => Boolean(userAccountId));


  if (id) {
    await updateRole(id, name, description, userAccountsIds);
  } else {
    await addRole(name, description, userAccountsIds);
  }

  revalidatePath('/');
  redirect('/role');
}

async function addRole(name: string, description: string | null, userAccountsIds: string[]) {
  await prisma.role.create({
    data: {
      name: name,
      description: description,
      user_accounts: {
        connect: userAccountsIds.map((id) => ({ id })),
      },
    },
  });
}

async function updateRole(id: string, name: string, description: string | null, userAccountsIds: string[]) {
  await prisma.role.update({
    where: { id },
    data: {
      name: name,
      description: description,
      user_accounts: {
        set: userAccountsIds.map((id) => ({ id })),
      },
    },
  });
}

export async function removeRole(data: FormData | string[]) {
  await requirePermission('role', 'delete');

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
