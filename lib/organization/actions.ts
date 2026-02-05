'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertOrganization(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('organization', 'update');
  } else {
    await requirePermission('organization', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const userAccountsRaw = data.getAll('userAccount[]') as string[];
  const userAccounts = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const userAccountIds = userAccounts
    .map((userAccount) => userAccount.id)
    .filter((userAccountId): userAccountId is string => Boolean(userAccountId));

  if (id) {
    await updateOrganization(id, name, description, userAccountIds);
  } else {
    await addOrganization(name, description, userAccountIds);
  }

  revalidatePath('/');
  redirect('/organization');
}

async function addOrganization(name: string, description: string | null, userAccountIds: string[]) {
  await prisma.organization.create({
    data: {
      name: name,
      description: description,
      user_accounts: {
        connect: userAccountIds.map((id) => ({ id })),
      },
    },
  });
}

async function updateOrganization(id: string, name: string, description: string | null, userAccountIds: string[]) {
  await prisma.organization.update({
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

export async function removeOrganization(data: FormData | string[]) {
  await requirePermission('organization', 'delete');

  if (Array.isArray(data)) {
    await prisma.organization.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.organization.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/organization');
}
