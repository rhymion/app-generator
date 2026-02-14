'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting7, updateSetting7 } from './service';

export async function upsertSetting7(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('setting7', 'update');
  } else {
    await requirePermission('setting7', 'create');
  }
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;
  const apiKey = data.get('api_key') as string | null;
  const avatar = data.get('avatar') as string | null;

  if (id) {
    await updateSetting7(id, name, email, password, apiKey, avatar, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addSetting7(creatorId, name, email, password, apiKey, avatar);
  }

  revalidatePath('/');
  redirect('/setting7');
}
