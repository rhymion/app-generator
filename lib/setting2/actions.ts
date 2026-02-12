'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting2, updateSetting2 } from './service';

export async function upsertSetting2(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('user_account', 'update');
  } else {
    await requirePermission('user_account', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;

  if (id) {
    await updateSetting2(id, name, email, password, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addSetting2(creatorId, name, email, password);
  }

  revalidatePath('/');
  redirect('/setting2');
}
