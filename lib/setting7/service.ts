import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'xxxxx_xxxxx'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    team: normalizeValue(safeSnapshot.team, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.xxxxx_xxxxx.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addSetting7(creatorId: string, name: string, description: string | null, team: string | null) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
      team: team,
    });
    return await tx.xxxxx_xxxxx.create({
      data: {
        name: name,
        description: description,
        team: team,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}

export async function updateSetting7(updaterId: string, id: string, name: string, description: string | null, team: string | null, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
      team: team,
    });
    return await tx.xxxxx_xxxxx.update({
      where: { id },
      data: {
        name: name,
        description: description,
        team: team,
        updater_id: updaterId,
      },
    });
  });
}
