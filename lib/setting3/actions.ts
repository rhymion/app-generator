'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { updateSetting3, deleteSetting3 } from './service';

export async function upsertSetting3(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  await requirePermission('setting3', 'update');
  const name = data.get('name') as string;
  const email = data.get('email') as string;

  await updateSetting3(id, name, email, srcSnapshotRaw);

  revalidatePath('/');
  redirect('/setting3');
}

export async function removeSetting3(data: FormData | string[]) {
  await requirePermission('setting3', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteSetting3(ids);
  revalidatePath('/');
  redirect('/setting3');
}
