'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addCreator, updateCreator, deleteCreator } from './service';
export async function upsertCreator(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.creator.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('creator', 'update', existing);
  } else {
    await requirePermission('creator', 'create');
  }
  const name = data.get('name') as string;
  const role = Number(data.get('role'));
  const affiliation = Number(data.get('affiliation'));
  const voicedCharactersRaw = data.getAll('voiced_character[]') as string[];
  const voicedCharactersItems = voicedCharactersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const voicedCharactersIds = voicedCharactersItems
    .map((voicedCharacter) => voicedCharacter.id)
    .filter((voicedCharacterId): voicedCharacterId is string => Boolean(voicedCharacterId));
  const composedMusicsRaw = data.getAll('composed_music[]') as string[];
  const composedMusicsItems = composedMusicsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const composedMusicsIds = composedMusicsItems
    .map((composedMusic) => composedMusic.id)
    .filter((composedMusicId): composedMusicId is string => Boolean(composedMusicId));
  const creditedMusicsRaw = data.getAll('credited_music[]') as string[];
  const creditedMusicsItems = creditedMusicsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const creditedMusicsIds = creditedMusicsItems
    .map((creditedMusic) => creditedMusic.id)
    .filter((creditedMusicId): creditedMusicId is string => Boolean(creditedMusicId));
  const creditedScenesRaw = data.getAll('credited_scene[]') as string[];
  const creditedScenesItems = creditedScenesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const creditedScenesIds = creditedScenesItems
    .map((creditedScene) => creditedScene.id)
    .filter((creditedSceneId): creditedSceneId is string => Boolean(creditedSceneId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateCreator(actorId, id, name, role, affiliation, voicedCharactersIds, composedMusicsIds, creditedMusicsIds, creditedScenesIds, srcSnapshotRaw);
  } else {
    await addCreator(actorId, name, role, affiliation, voicedCharactersIds, composedMusicsIds, creditedMusicsIds, creditedScenesIds);
  }

  redirect('/creator');
}
export async function removeCreator(ids: string[]) {
  const [{ permissions: userPermissions, userId }, creators] = await Promise.all([
    getModelPermissions('creator'),
    await prisma.creator.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredCreators = userPermissions.general.delete
    ? creators
    : creators.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredCreators.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteCreator(filteredCreators.map(item => item.id));
  revalidatePath('/[locale]/creator', 'page');
  redirect('/creator');
}

