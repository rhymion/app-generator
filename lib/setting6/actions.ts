'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { deleteSetting6 } from './service';

export async function removeSetting6(data: FormData | string[]) {
  await requirePermission('setting6', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteSetting6(ids);
  revalidatePath('/');
  redirect('/setting6');
}
