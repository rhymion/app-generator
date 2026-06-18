'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addCharacter, updateCharacter, deleteCharacter } from './service';
export async function upsertCharacter(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.character.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('character', 'update', existing);
  } else {
    await requirePermission('character', 'create');
  }
  const name = data.get('name') as string;
  const workId = data.get('work_id') as string;
  const officialImage = data.get('official_image') === 'true';
  const scenesRaw = data.getAll('scene[]') as string[];
  const scenesItems = scenesRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const scenesIds = scenesItems
    .map((scene) => scene.id)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
  const creatorsRaw = data.getAll('creator[]') as string[];
  const creatorsItems = creatorsRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const creatorsIds = creatorsItems
    .map((creator) => creator.id)
    .filter((creatorId): creatorId is string => Boolean(creatorId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateCharacter(actorId, id, name, workId, officialImage, scenesIds, creatorsIds, srcSnapshotRaw);
  } else {
    await addCharacter(actorId, name, workId, officialImage, scenesIds, creatorsIds);
  }

  redirect('/character');
}
export async function removeCharacter(ids: string[]) {
  const [{ permissions: userPermissions, userId }, characters] = await Promise.all([
    getModelPermissions('character'),
    await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredCharacters = userPermissions.general.delete
    ? characters
    : characters.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredCharacters.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteCharacter(filteredCharacters.map(item => item.id));
  revalidatePath('/[locale]/character', 'page');
  redirect('/character');
}

