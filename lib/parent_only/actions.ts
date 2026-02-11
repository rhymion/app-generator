'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addParentOnly, updateParentOnly, deleteParentOnly } from './service';

export async function upsertParentOnly(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('parent_only', 'update');
  } else {
    await requirePermission('parent_only', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const loginTimeStr = data.get('login_time') as string | null;
  const loginTime = loginTimeStr ? new Date(loginTimeStr) : null;
  const logoutTimeStr = data.get('logout_time') as string | null;
  const logoutTime = logoutTimeStr ? new Date(logoutTimeStr) : null;

  if (id) {
    await updateParentOnly(id, name, description, loginTime, logoutTime, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addParentOnly(creatorId, name, description, loginTime, logoutTime);
  }

  revalidatePath('/');
  redirect('/parent_only');
}

export async function removeParentOnly(data: FormData | string[]) {
  await requirePermission('parent_only', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteParentOnly(ids);
  revalidatePath('/');
  redirect('/parent_only');
}
