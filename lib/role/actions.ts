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
  const userAccountsRaw = data.getAll('userAccount[]') as string[];
  const userAccounts = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const userAccountIds = userAccounts
    .map((userAccount) => userAccount.id)
    .filter((userAccountId): userAccountId is string => Boolean(userAccountId));

  if (id) {
    await updateRole(id, name, description, userAccountIds);
  } else {
    await addRole(name, description, userAccountIds);
  }

  revalidatePath('/');
  redirect('/role');
}

async function addRole(name: string, description: string | null, userAccountIds: string[]) {
  await prisma.role.create({
    data: {
      name: name,
      description: description,
      user_accounts: {
        connect: userAccountIds.map((id) => ({ id })),
      },
    },
  });
}

async function updateRole(id: string, name: string, description: string | null, userAccountIds: string[]) {
  await prisma.role.update({
    where: { id },
    data: {
      name: name,
      description: description,
      user_accounts: {
        set: userAccountIds.map((id) => ({ id })),
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
