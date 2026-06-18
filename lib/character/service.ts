import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'character'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    work_id: normalizeValue(safeSnapshot.work_id, 'string'),
    official_image: normalizeValue(safeSnapshot.official_image, 'boolean'),
    scenes: normalizeChildRefs(safeSnapshot.scenes),
    creators: normalizeChildRefs(safeSnapshot.creators),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.character.findUnique({
    where: { id },
    include: {
      scenes: { select: { id: true } },
      creators: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addCharacter(actorId: string, name: string, workId: string, officialImage: boolean, scenesIds: string[], creatorsIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      work_id: workId,
      official_image: officialImage,
    });
    const channelable = await tx.channelable.create({ data: {} });
    const fc_linkable = await tx.fc_linkable.create({ data: {} });
    const created = await tx.character.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        name: name,
        work_id: workId,
        official_image: officialImage,
        channelable_id: channelable.id,
        fc_linkable_id: fc_linkable.id,
      scenes: {
        connect: scenesIds.map((id) => ({ id })),
      },
      creators: {
        connect: creatorsIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, { ...created, channelable: { id: created.channelable_id }, fc_linkable: { id: created.fc_linkable_id } } as Record<string, unknown>, {
      name: name,
      work_id: workId,
      official_image: officialImage,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateCharacter(actorId: string, id: string, name: string, workId: string, officialImage: boolean, scenesIds: string[], creatorsIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      work_id: workId,
      official_image: officialImage,
    });
    await tx.character.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        work_id: workId,
        official_image: officialImage,
      scenes: {
        set: scenesIds.map((id) => ({ id })),
      },
      creators: {
        set: creatorsIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteCharacter(ids: string[]): Promise<void> {
  const _bridgeRows = await prisma.character.findMany({ where: { id: { in: ids } }, select: { channelable_id: true, fc_linkable_id: true } });
  await prisma.character.deleteMany({ where: { id: { in: ids } } });
  await prisma.channelable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.channelable_id).filter(Boolean) } } });
  await prisma.fc_linkable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.fc_linkable_id).filter(Boolean) } } });
}
