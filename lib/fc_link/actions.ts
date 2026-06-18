'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addFcLink, updateFcLink, deleteFcLink } from './service';
export async function upsertFcLink(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.fc_link.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('fc_link', 'update', existing);
  } else {
    await requirePermission('fc_link', 'create');
  }
  const name = data.get('name') as string;
  const url = data.get('url') as string;
  const selectedParentType = data.get('selectedParentType') as string;
  const selectedParentId = data.get('selectedParentId') as string;
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateFcLink(actorId, id, name, url, srcSnapshotRaw);
  } else {
    await addFcLink(actorId, name, url, selectedParentType, selectedParentId);
  }

  redirect('/fc_link');
}
export async function removeFcLink(ids: string[]) {
  const [{ permissions: userPermissions, userId }, fcLinks] = await Promise.all([
    getModelPermissions('fc_link'),
    await prisma.fc_link.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredFcLinks = userPermissions.general.delete
    ? fcLinks
    : fcLinks.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredFcLinks.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteFcLink(filteredFcLinks.map(item => item.id));
  revalidatePath('/[locale]/fc_link', 'page');
  redirect('/fc_link');
}

