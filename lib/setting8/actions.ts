'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting8, deleteSetting8 } from './service';

export async function upsertSetting8(data: FormData) {
  await requirePermission('user_account', 'create');
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;

  const creatorId = await getSessionUserIdOrThrow();
  await addSetting8(creatorId, name, email, password);

  revalidatePath('/');
  redirect('/setting8');
}

export async function removeSetting8(data: FormData | string[]) {
  await requirePermission('user_account', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteSetting8(ids);
  revalidatePath('/');
  redirect('/setting8');
}
