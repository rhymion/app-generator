import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'work'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    title: normalizeValue(safeSnapshot.title, 'string'),
    pattern: normalizeValue(safeSnapshot.pattern, 'number'),
    status: normalizeValue(safeSnapshot.status, 'number'),
    characters: normalizeChildRefs(safeSnapshot.characters),
    scenes: normalizeChildRefs(safeSnapshot.scenes),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.work.findUnique({
    where: { id },
    include: {
      characters: { select: { id: true } },
      scenes: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addWork(actorId: string, title: string, pattern: number, status: number, charactersIds: string[], scenesIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      title: title,
      pattern: pattern,
      status: status,
    });
    const channelable = await tx.channelable.create({ data: {} });
    const fc_linkable = await tx.fc_linkable.create({ data: {} });
    const created = await tx.work.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        title: title,
        pattern: pattern,
        status: status,
        channelable_id: channelable.id,
        fc_linkable_id: fc_linkable.id,
      characters: {
        connect: charactersIds.map((id) => ({ id })),
      },
      scenes: {
        connect: scenesIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, { ...created, channelable: { id: created.channelable_id }, fc_linkable: { id: created.fc_linkable_id } } as Record<string, unknown>, {
      title: title,
      pattern: pattern,
      status: status,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateWork(actorId: string, id: string, title: string, pattern: number, status: number, charactersIds: string[], scenesIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      title: title,
      pattern: pattern,
      status: status,
    });
    await tx.work.update({
      where: { id },
      data: {
        updater_id: actorId,
        title: title,
        pattern: pattern,
        status: status,
      characters: {
        set: charactersIds.map((id) => ({ id })),
      },
      scenes: {
        set: scenesIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteWork(ids: string[]): Promise<void> {
  const _bridgeRows = await prisma.work.findMany({ where: { id: { in: ids } }, select: { channelable_id: true, fc_linkable_id: true } });
  await prisma.work.deleteMany({ where: { id: { in: ids } } });
  await prisma.channelable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.channelable_id).filter(Boolean) } } });
  await prisma.fc_linkable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.fc_linkable_id).filter(Boolean) } } });
}
