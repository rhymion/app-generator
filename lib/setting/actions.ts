'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting, updateSetting, deleteSetting } from './service';

export async function upsertSetting(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('user_account', 'update');
  } else {
    await requirePermission('user_account', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;

  if (id) {
    await updateSetting(id, name, email, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addSetting(creatorId, name, email);
  }

  revalidatePath('/');
  redirect('/setting');
}

export async function removeSetting(data: FormData | string[]) {
  await requirePermission('user_account', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteSetting(ids);
  revalidatePath('/');
  redirect('/setting');
}
