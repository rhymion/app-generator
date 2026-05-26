'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { updateSetting } from './service';
export async function upsertSetting(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, creator_id: true } });
  await requirePermission('setting', 'update', existing);
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string | null;
  const apiKey = data.get('api_key') as string | null;
  const image = data.get('image') as string | null;
  const rolesRaw = data.getAll('role[]') as string[];
  const rolesItems = rolesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const rolesIds = rolesItems
    .map((role) => role.id)
    .filter((roleId): roleId is string => Boolean(roleId));

  const actorId = await getSessionUserIdOrThrow();
  await updateSetting(actorId, id, name, email, password, apiKey, image, rolesIds, srcSnapshotRaw);

  redirect('/setting');
}

