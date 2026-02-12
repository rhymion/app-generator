'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addSetting5, updateSetting5 } from './service';

export async function upsertSetting5(data: FormData) {
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
    await updateSetting5(id, name, email, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addSetting5(creatorId, name, email);
  }

  revalidatePath('/');
  redirect('/setting5');
}
