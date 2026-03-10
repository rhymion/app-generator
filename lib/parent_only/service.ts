import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

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
export async function addParentOnly(userId: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
    });
    const created = await tx.parent_only.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        description: description,
        login_time: loginTime,
        logout_time: logoutTime,
      },
    });
    return { id: created.id };
  });
}
export async function updateParentOnly(userId: string, id: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
    });
    await tx.parent_only.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        description: description,
        login_time: loginTime,
        logout_time: logoutTime,
      },
    });
  });
}
export async function deleteParentOnly(ids: string[]): Promise<void> {
  await prisma.parent_only.deleteMany({ where: { id: { in: ids } } });
}
