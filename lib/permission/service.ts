import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'permission'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    create: normalizeValue(safeSnapshot.create, 'boolean'),
    read: normalizeValue(safeSnapshot.read, 'boolean'),
    update: normalizeValue(safeSnapshot.update, 'boolean'),
    delete: normalizeValue(safeSnapshot.delete, 'boolean'),
    role_id: normalizeValue(safeSnapshot.role_id, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.permission.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addPermission(creatorId: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null) {
  return await prisma.$transaction(async (tx) => {
    return await tx.permission.create({
      data: {
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}

export async function updatePermission(updaterId: string, id: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.permission.update({
      where: { id },
      data: {
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
        updater_id: updaterId,
      },
    });
  });
}

export async function deletePermission(ids: string[]) {
  if (ids.length === 1) {
    await prisma.permission.delete({ where: { id: ids[0] } });
  } else {
    await prisma.permission.deleteMany({ where: { id: { in: ids } } });
  }
}
