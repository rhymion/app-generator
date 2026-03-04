import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'shift'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    user_account_id: normalizeValue(safeSnapshot.user_account_id, 'string'),
    start_time: normalizeValue(safeSnapshot.start_time, 'date'),
    end_time: normalizeValue(safeSnapshot.end_time, 'date'),
    status: normalizeValue(safeSnapshot.status, 'number'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.shift.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addShift(creatorId: string, userAccountId: string, startTime: Date, endTime: Date, status: number) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      user_account_id: userAccountId,
      start_time: startTime,
      end_time: endTime,
      status: status,
    });
    return await tx.shift.create({
      data: {
        user_account_id: userAccountId,
        start_time: startTime,
        end_time: endTime,
        status: status,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}

export async function updateShift(updaterId: string, id: string, userAccountId: string, startTime: Date, endTime: Date, status: number, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      user_account_id: userAccountId,
      start_time: startTime,
      end_time: endTime,
      status: status,
    });
    return await tx.shift.update({
      where: { id },
      data: {
        user_account_id: userAccountId,
        start_time: startTime,
        end_time: endTime,
        status: status,
        updater_id: updaterId,
      },
    });
  });
}

export async function deleteShift(ids: string[]) {
  if (ids.length === 1) {
    await prisma.shift.delete({ where: { id: ids[0] } });
  } else {
    await prisma.shift.deleteMany({ where: { id: { in: ids } } });
  }
}
