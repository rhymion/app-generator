'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addWork, updateWork, deleteWork } from './service';
export async function upsertWork(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.work.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('work', 'update', existing);
  } else {
    await requirePermission('work', 'create');
  }
  const title = data.get('title') as string;
  const pattern = Number(data.get('pattern'));
  const status = Number(data.get('status'));
  const charactersRaw = data.getAll('character[]') as string[];
  const charactersItems = charactersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const charactersIds = charactersItems
    .map((character) => character.id)
    .filter((characterId): characterId is string => Boolean(characterId));
  const scenesRaw = data.getAll('scene[]') as string[];
  const scenesItems = scenesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const scenesIds = scenesItems
    .map((scene) => scene.id)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateWork(actorId, id, title, pattern, status, charactersIds, scenesIds, srcSnapshotRaw);
  } else {
    await addWork(actorId, title, pattern, status, charactersIds, scenesIds);
  }

  redirect('/work');
}
export async function removeWork(ids: string[]) {
  const [{ permissions: userPermissions, userId }, works] = await Promise.all([
    getModelPermissions('work'),
    await prisma.work.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredWorks = userPermissions.general.delete
    ? works
    : works.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredWorks.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteWork(filteredWorks.map(item => item.id));
  revalidatePath('/[locale]/work', 'page');
  redirect('/work');
}

