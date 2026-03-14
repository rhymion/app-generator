'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addParentOnly, updateParentOnly, deleteParentOnly } from './service';
export async function upsertParentOnly(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.parent_only.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('parent_only', 'update', existing);
  } else {
    await requirePermission('parent_only', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const loginTimeStr = data.get('login_time') as string | null;
  const loginTime = loginTimeStr ? new Date(loginTimeStr) : null;
  const logoutTimeStr = data.get('logout_time') as string | null;
  const logoutTime = logoutTimeStr ? new Date(logoutTimeStr) : null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateParentOnly(userId, id, name, description, loginTime, logoutTime, srcSnapshotRaw);
  } else {
    await addParentOnly(userId, name, description, loginTime, logoutTime);
  }

  revalidatePath('/parent_only');
  redirect('/parent_only');
}
export async function removeParentOnly(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.parent_only.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('parent_only', 'delete', item);
  }
  await deleteParentOnly(ids);
  revalidatePath('/parent_only');
  redirect('/parent_only');
}

