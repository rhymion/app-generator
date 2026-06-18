import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'creator'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    role: normalizeValue(safeSnapshot.role, 'number'),
    affiliation: normalizeValue(safeSnapshot.affiliation, 'number'),
    voiced_characters: normalizeChildRefs(safeSnapshot.voiced_characters),
    composed_musics: normalizeChildRefs(safeSnapshot.composed_musics),
    credited_musics: normalizeChildRefs(safeSnapshot.credited_musics),
    credited_scenes: normalizeChildRefs(safeSnapshot.credited_scenes),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.creator.findUnique({
    where: { id },
    include: {
      voiced_characters: { select: { id: true } },
      composed_musics: { select: { id: true } },
      credited_musics: { select: { id: true } },
      credited_scenes: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addCreator(actorId: string, name: string, role: number, affiliation: number, voicedCharactersIds: string[], composedMusicsIds: string[], creditedMusicsIds: string[], creditedScenesIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      role: role,
      affiliation: affiliation,
    });
    const created = await tx.creator.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        name: name,
        role: role,
        affiliation: affiliation,
      voiced_characters: {
        connect: voicedCharactersIds.map((id) => ({ id })),
      },
      composed_musics: {
        connect: composedMusicsIds.map((id) => ({ id })),
      },
      credited_musics: {
        connect: creditedMusicsIds.map((id) => ({ id })),
      },
      credited_scenes: {
        connect: creditedScenesIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      name: name,
      role: role,
      affiliation: affiliation,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateCreator(actorId: string, id: string, name: string, role: number, affiliation: number, voicedCharactersIds: string[], composedMusicsIds: string[], creditedMusicsIds: string[], creditedScenesIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      role: role,
      affiliation: affiliation,
    });
    await tx.creator.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        role: role,
        affiliation: affiliation,
      voiced_characters: {
        set: voicedCharactersIds.map((id) => ({ id })),
      },
      composed_musics: {
        set: composedMusicsIds.map((id) => ({ id })),
      },
      credited_musics: {
        set: creditedMusicsIds.map((id) => ({ id })),
      },
      credited_scenes: {
        set: creditedScenesIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteCreator(ids: string[]): Promise<void> {
  await prisma.creator.deleteMany({ where: { id: { in: ids } } });
}
