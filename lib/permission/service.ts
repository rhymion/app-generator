import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

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
export async function addPermission(userId: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    });
    const created = await tx.permission.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
      },
    });
    return { id: created.id };
  });
}
export async function updatePermission(userId: string, id: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    });
    await tx.permission.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
      },
    });
  });
}
export async function deletePermission(ids: string[]): Promise<void> {
  await prisma.permission.deleteMany({ where: { id: { in: ids } } });
}
