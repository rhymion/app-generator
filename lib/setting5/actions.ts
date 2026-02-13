'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { updateSetting5 } from './service';

export async function upsertSetting5(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  await requirePermission('user_account', 'update');
  const name = data.get('name') as string;
  const email = data.get('email') as string;

  await updateSetting5(id, name, email, srcSnapshotRaw);

  revalidatePath('/');
  redirect('/setting5');
}
