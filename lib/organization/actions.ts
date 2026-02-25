'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addOrganization, updateOrganization, deleteOrganization } from './service';

export async function upsertOrganization(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.organization.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('organization', 'update', existing);
  } else {
    await requirePermission('organization', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const userAccountsRaw = data.getAll('user_account[]') as string[];
  const userAccountsItems = userAccountsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const userAccountsIds = userAccountsItems
    .map((userAccount) => userAccount.id)
    .filter((userAccountId): userAccountId is string => Boolean(userAccountId));
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateOrganization(userId, id, name, description, userAccountsIds, srcSnapshotRaw);
  } else {
    await addOrganization(userId, name, description, userAccountsIds);
  }

  revalidatePath('/');
  redirect('/organization');
}

export async function removeOrganization(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('organization', 'delete', item);
  }
  await deleteOrganization(ids);
  revalidatePath('/');
  redirect('/organization');
}
