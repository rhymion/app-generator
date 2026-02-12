import prisma from '@/lib/prisma';
import { normalizeValue, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'parent_only'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    login_time: normalizeValue(safeSnapshot.login_time, 'date'),
    logout_time: normalizeValue(safeSnapshot.logout_time, 'date'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.parent_only.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

async function assertNotStale(tx: TransactionClient, id: string, srcSnapshotRaw: string) {
  let expectedSnapshot: NormalizedSnapshot;
  try {
    expectedSnapshot = normalizeSnapshot(JSON.parse(srcSnapshotRaw) as Record<string, unknown>);
  } catch {
    throw new Error('Invalid snapshot data. Please reload and try again.');
  }

  const currentSnapshot = await getCurrentSnapshot(tx, id);
  if (!currentSnapshot) {
    throw new Error('This record no longer exists.');
  }

  if (JSON.stringify(currentSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error('This record has been updated since you opened it. Please reload to compare with the latest changes.');
  }
}

export async function addParentOnly(creatorId: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null) {
  return await prisma.parent_only.create({
    data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
      creator_id: creatorId,
    },
  });
}

export async function updateParentOnly(id: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(tx, id, srcSnapshotRaw);
    }
    return await tx.parent_only.update({
      where: { id },
      data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
      },
    });
  });
}

export async function deleteParentOnly(ids: string[]) {
  if (ids.length === 1) {
    await prisma.parent_only.delete({ where: { id: ids[0] } });
  } else {
    await prisma.parent_only.deleteMany({ where: { id: { in: ids } } });
  }
}
