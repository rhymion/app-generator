import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'organization'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    user_accounts: normalizeChildRefs(safeSnapshot.user_accounts),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.organization.findUnique({
    where: { id },
    include: {
      user_accounts: { select: { id: true } }
    }
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

export async function addOrganization(creatorId: string, name: string, description: string | null, userAccountsIds: string[]) {
  return await prisma.organization.create({
    data: {
      name: name,
      description: description,
      creator_id: creatorId,
      user_accounts: {
        connect: userAccountsIds.map((id) => ({ id })),
      },
    },
  });
}

export async function updateOrganization(id: string, name: string, description: string | null, userAccountsIds: string[], srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(tx, id, srcSnapshotRaw);
    }
    return await tx.organization.update({
      where: { id },
      data: {
      name: name,
      description: description,
      user_accounts: {
        set: userAccountsIds.map((id) => ({ id })),
      },
      },
    });
  });
}

export async function deleteOrganization(ids: string[]) {
  if (ids.length === 1) {
    await prisma.organization.delete({ where: { id: ids[0] } });
  } else {
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  }
}
