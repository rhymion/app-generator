import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';
import { recordAuditEvent } from '@/lib/audit-log';

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
export async function addPermission(actorId: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
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
        creator_id: actorId,
        updater_id: actorId,
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    });
    await recordAuditEvent({
      action: 'permission:create',
      actor_user_id: actorId,
      target_table: 'permission',
      target_id: created.id,
      tx,
    });
    return { id: created.id };
  });
  return result;
}
export async function updatePermission(actorId: string, id: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null, srcSnapshotRaw: string | null): Promise<void> {
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
        updater_id: actorId,
        name: name,
        create: create,
        read: read,
        update: update,
        delete: deleteValue,
        role_id: roleId,
      },
    });
    await recordAuditEvent({
      action: 'permission:update',
      actor_user_id: actorId,
      target_table: 'permission',
      target_id: id,
      tx,
    });
  });
}
export async function deletePermission(actorId: string | null, ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.permission.deleteMany({ where: { id: { in: ids } } });
    for (const id of ids) {
      await recordAuditEvent({
        action: 'permission:delete',
        actor_user_id: actorId,
        target_table: 'permission',
        target_id: id,
        tx,
      });
    }
  });
}
