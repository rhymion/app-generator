'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addMusic, updateMusic, deleteMusic } from './service';
export async function upsertMusic(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.music.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('music', 'update', existing);
  } else {
    await requirePermission('music', 'create');
  }
  const title = data.get('title') as string;
  const kind = Number(data.get('kind'));
  const scenesRaw = data.getAll('scene[]') as string[];
  const scenesItems = scenesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const scenesIds = scenesItems
    .map((scene) => scene.id)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
  const composersRaw = data.getAll('composer[]') as string[];
  const composersItems = composersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const composersIds = composersItems
    .map((composer) => composer.id)
    .filter((composerId): composerId is string => Boolean(composerId));
  const creditsRaw = data.getAll('credit[]') as string[];
  const creditsItems = creditsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const creditsIds = creditsItems
    .map((credit) => credit.id)
    .filter((creditId): creditId is string => Boolean(creditId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateMusic(actorId, id, title, kind, scenesIds, composersIds, creditsIds, srcSnapshotRaw);
  } else {
    await addMusic(actorId, title, kind, scenesIds, composersIds, creditsIds);
  }

  redirect('/music');
}
export async function removeMusic(ids: string[]) {
  const [{ permissions: userPermissions, userId }, musics] = await Promise.all([
    getModelPermissions('music'),
    await prisma.music.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredMusics = userPermissions.general.delete
    ? musics
    : musics.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredMusics.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteMusic(filteredMusics.map(item => item.id));
  revalidatePath('/[locale]/music', 'page');
  redirect('/music');
}

