import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

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
export async function addOrganization(userId: string, name: string, description: string | null, userAccountsIds: string[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
    });
    const created = await tx.organization.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        description: description,
      user_accounts: {
        connect: userAccountsIds.map((id) => ({ id })),
      },
      },
    });
    return { id: created.id };
  });
}
export async function updateOrganization(userId: string, id: string, name: string, description: string | null, userAccountsIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
    });
    await tx.organization.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        description: description,
      user_accounts: {
        set: userAccountsIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteOrganization(ids: string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}
