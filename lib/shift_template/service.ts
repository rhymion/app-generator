import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'shift_template'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    user_account_id: normalizeValue(safeSnapshot.user_account_id, 'string'),
    day_of_week: normalizeValue(safeSnapshot.day_of_week, 'number'),
    start_time: normalizeValue(safeSnapshot.start_time, 'date'),
    end_time: normalizeValue(safeSnapshot.end_time, 'date'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.shift_template.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addShiftTemplate(creatorId: string, userAccountId: string, dayOfWeek: number, startTime: Date, endTime: Date) {
  return await prisma.$transaction(async (tx) => {
    return await tx.shift_template.create({
      data: {
        user_account_id: userAccountId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}

export async function updateShiftTemplate(updaterId: string, id: string, userAccountId: string, dayOfWeek: number, startTime: Date, endTime: Date, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.shift_template.update({
      where: { id },
      data: {
        user_account_id: userAccountId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        updater_id: updaterId,
      },
    });
  });
}

export async function deleteShiftTemplate(ids: string[]) {
  if (ids.length === 1) {
    await prisma.shift_template.delete({ where: { id: ids[0] } });
  } else {
    await prisma.shift_template.deleteMany({ where: { id: { in: ids } } });
  }
}
