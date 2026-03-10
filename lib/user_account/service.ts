import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'user_account'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    avatar: normalizeValue(safeSnapshot.avatar, 'string'),
    roles: normalizeChildRefs(safeSnapshot.roles),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.user_account.findUnique({
    where: { id },
    include: {
      roles: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function updateUserAccount(userId: string, id: string, name: string, avatar: string | null, rolesIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      avatar: avatar,
    });
    await tx.user_account.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        avatar: avatar,
      roles: {
        set: rolesIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteUserAccount(ids: string[]): Promise<void> {
  await prisma.user_account.deleteMany({ where: { id: { in: ids } } });
}
