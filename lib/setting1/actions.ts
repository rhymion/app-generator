'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting1, updateSetting1, deleteSetting1 } from './service';

export async function upsertSetting1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('setting1', 'update');
  } else {
    await requirePermission('setting1', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateSetting1(userId, id, name, email, password, apiKey, avatar, srcSnapshotRaw);
  } else {
    await addSetting1(userId, name, email, password, apiKey, avatar);
  }

  revalidatePath('/');
  redirect('/setting1');
}

export async function removeSetting1(data: FormData | string[]) {
  await requirePermission('setting1', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteSetting1(ids);
  revalidatePath('/');
  redirect('/setting1');
}
