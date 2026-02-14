'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting2 } from './service';

export async function upsertSetting2(data: FormData) {
  await requirePermission('setting2', 'create');
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;

  const creatorId = await getSessionUserIdOrThrow();
  await addSetting2(creatorId, name, email, password);

  revalidatePath('/');
  redirect('/setting2');
}
