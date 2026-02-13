'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addRole, updateRole, deleteRole } from './service';

export async function upsertRole(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
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
    await updateRole(id, name, description, userAccountsIds, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addRole(creatorId, name, description, userAccountsIds);
  }

  revalidatePath('/');
  redirect('/role');
}

export async function removeRole(data: FormData | string[]) {
  await requirePermission('role', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteRole(ids);
  revalidatePath('/');
  redirect('/role');
}
