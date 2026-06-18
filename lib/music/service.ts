import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'music'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    title: normalizeValue(safeSnapshot.title, 'string'),
    kind: normalizeValue(safeSnapshot.kind, 'number'),
    scenes: normalizeChildRefs(safeSnapshot.scenes),
    composers: normalizeChildRefs(safeSnapshot.composers),
    credits: normalizeChildRefs(safeSnapshot.credits),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.music.findUnique({
    where: { id },
    include: {
      scenes: { select: { id: true } },
      composers: { select: { id: true } },
      credits: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addMusic(actorId: string, title: string, kind: number, scenesIds: string[], composersIds: string[], creditsIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      title: title,
      kind: kind,
    });
    const fc_linkable = await tx.fc_linkable.create({ data: {} });
    const created = await tx.music.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        title: title,
        kind: kind,
        fc_linkable_id: fc_linkable.id,
      scenes: {
        connect: scenesIds.map((id) => ({ id })),
      },
      composers: {
        connect: composersIds.map((id) => ({ id })),
      },
      credits: {
        connect: creditsIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, { ...created, fc_linkable: { id: created.fc_linkable_id } } as Record<string, unknown>, {
      title: title,
      kind: kind,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateMusic(actorId: string, id: string, title: string, kind: number, scenesIds: string[], composersIds: string[], creditsIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      title: title,
      kind: kind,
    });
    await tx.music.update({
      where: { id },
      data: {
        updater_id: actorId,
        title: title,
        kind: kind,
      scenes: {
        set: scenesIds.map((id) => ({ id })),
      },
      composers: {
        set: composersIds.map((id) => ({ id })),
      },
      credits: {
        set: creditsIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteMusic(ids: string[]): Promise<void> {
  const _bridgeRows = await prisma.music.findMany({ where: { id: { in: ids } }, select: { fc_linkable_id: true } });
  await prisma.music.deleteMany({ where: { id: { in: ids } } });
  await prisma.fc_linkable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.fc_linkable_id).filter(Boolean) } } });
}
