'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting7, updateSetting7 } from './service';
export async function upsertSetting7(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('setting7', 'update', existing);
  } else {
    await requirePermission('setting7', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const team = data.get('team') as string | null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateSetting7(userId, id, name, description, team, srcSnapshotRaw);
  } else {
    await addSetting7(userId, name, description, team);
  }

  redirect('/setting7');
}

