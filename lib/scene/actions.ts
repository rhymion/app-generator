'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addScene, updateScene, deleteScene } from './service';
export async function upsertScene(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.scene.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('scene', 'update', existing);
  } else {
    await requirePermission('scene', 'create');
  }
  const label = data.get('label') as string;
  const workId = data.get('work_id') as string;
  const episode = data.get('episode') as string;
  const timestamp = data.get('timestamp') as string;
  const charactersRaw = data.getAll('character[]') as string[];
  const charactersItems = charactersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const charactersIds = charactersItems
    .map((character) => character.id)
    .filter((characterId): characterId is string => Boolean(characterId));
  const musicRaw = data.getAll('music[]') as string[];
  const musicItems = musicRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const musicIds = musicItems
    .map((music) => music.id)
    .filter((musicId): musicId is string => Boolean(musicId));
  const creatorsRaw = data.getAll('creator[]') as string[];
  const creatorsItems = creatorsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const creatorsIds = creatorsItems
    .map((creator) => creator.id)
    .filter((creatorId): creatorId is string => Boolean(creatorId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateScene(actorId, id, label, workId, episode, timestamp, charactersIds, musicIds, creatorsIds, srcSnapshotRaw);
  } else {
    await addScene(actorId, label, workId, episode, timestamp, charactersIds, musicIds, creatorsIds);
  }

  redirect('/scene');
}
export async function removeScene(ids: string[]) {
  const [{ permissions: userPermissions, userId }, scenes] = await Promise.all([
    getModelPermissions('scene'),
    await prisma.scene.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredScenes = userPermissions.general.delete
    ? scenes
    : scenes.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredScenes.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteScene(filteredScenes.map(item => item.id));
  revalidatePath('/[locale]/scene', 'page');
  redirect('/scene');
}

