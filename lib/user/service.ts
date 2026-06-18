import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'user'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    image: normalizeValue(safeSnapshot.image, 'string'),
    roles: normalizeChildRefs(safeSnapshot.roles),
    sub_accounts: normalizeChildRefs(safeSnapshot.sub_accounts),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.user.findUnique({
    where: { id },
    include: {
      roles: { select: { id: true } },
      sub_accounts: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function updateUser(actorId: string, id: string, name: string, image: string | null, rolesIds: string[], subAccountsItems: { id?: string; nickname: string }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      image: image,
    });
    await tx.user.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        image: image,
      roles: {
        set: rolesIds.map((id) => ({ id })),
      },
      sub_accounts: {
        deleteMany: { id: { notIn: subAccountsItems.map(f => f.id).filter((id): id is string => Boolean(id)) } },
        update: subAccountsItems.filter(f => f.id).map(f => ({
          where: { id: f.id! },
          data: {
          nickname: f.nickname,
          },
        })),
        create: subAccountsItems.filter(f => !f.id).map(f => ({
          nickname: f.nickname,
        })),
      },
      },
    });
  });
}
export async function deleteUser(ids: string[]): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
