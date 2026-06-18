import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'scene'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    label: normalizeValue(safeSnapshot.label, 'string'),
    work_id: normalizeValue(safeSnapshot.work_id, 'string'),
    episode: normalizeValue(safeSnapshot.episode, 'string'),
    timestamp: normalizeValue(safeSnapshot.timestamp, 'string'),
    characters: normalizeChildRefs(safeSnapshot.characters),
    music: normalizeChildRefs(safeSnapshot.music),
    creators: normalizeChildRefs(safeSnapshot.creators),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.scene.findUnique({
    where: { id },
    include: {
      characters: { select: { id: true } },
      music: { select: { id: true } },
      creators: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addScene(actorId: string, label: string, workId: string, episode: string, timestamp: string, charactersIds: string[], musicIds: string[], creatorsIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      label: label,
      work_id: workId,
      episode: episode,
      timestamp: timestamp,
    });
    const channelable = await tx.channelable.create({ data: {} });
    const created = await tx.scene.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        label: label,
        work_id: workId,
        episode: episode,
        timestamp: timestamp,
        channelable_id: channelable.id,
      characters: {
        connect: charactersIds.map((id) => ({ id })),
      },
      music: {
        connect: musicIds.map((id) => ({ id })),
      },
      creators: {
        connect: creatorsIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, { ...created, channelable: { id: created.channelable_id } } as Record<string, unknown>, {
      label: label,
      work_id: workId,
      episode: episode,
      timestamp: timestamp,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateScene(actorId: string, id: string, label: string, workId: string, episode: string, timestamp: string, charactersIds: string[], musicIds: string[], creatorsIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      label: label,
      work_id: workId,
      episode: episode,
      timestamp: timestamp,
    });
    await tx.scene.update({
      where: { id },
      data: {
        updater_id: actorId,
        label: label,
        work_id: workId,
        episode: episode,
        timestamp: timestamp,
      characters: {
        set: charactersIds.map((id) => ({ id })),
      },
      music: {
        set: musicIds.map((id) => ({ id })),
      },
      creators: {
        set: creatorsIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteScene(ids: string[]): Promise<void> {
  const _bridgeRows = await prisma.scene.findMany({ where: { id: { in: ids } }, select: { channelable_id: true } });
  await prisma.scene.deleteMany({ where: { id: { in: ids } } });
  await prisma.channelable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.channelable_id).filter(Boolean) } } });
}
