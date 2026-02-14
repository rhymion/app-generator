'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import { addXxxxxXxxxx, updateXxxxxXxxxx, deleteXxxxxXxxxx } from './service';

export async function upsertXxxxxXxxxx(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('xxxxx_xxxxx', 'update');
  } else {
    await requirePermission('xxxxx_xxxxx', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const team = data.get('team') as string | null;
  const yyyyyYyyyysRaw = data.getAll('yyyyy_yyyyy[]') as string[];
  const yyyyyYyyyysItems = yyyyyYyyyysRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateXxxxxXxxxx(userId, id, name, description, team, yyyyyYyyyysItems, srcSnapshotRaw);
  } else {
    await addXxxxxXxxxx(userId, name, description, team, yyyyyYyyyysItems);
  }

  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}

export async function removeXxxxxXxxxx(data: FormData | string[]) {
  await requirePermission('xxxxx_xxxxx', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await deleteXxxxxXxxxx(ids);
  revalidatePath('/');
  redirect('/xxxxx_xxxxx');
}
