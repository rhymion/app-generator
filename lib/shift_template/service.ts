import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

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
export async function addShiftTemplate(userId: string, userAccountId: string, dayOfWeek: number, startTime: Date, endTime: Date): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      user_account_id: userAccountId,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
    });
    const created = await tx.shift_template.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        user_account_id: userAccountId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
      },
    });
    return { id: created.id };
  });
}
export async function updateShiftTemplate(userId: string, id: string, userAccountId: string, dayOfWeek: number, startTime: Date, endTime: Date, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      user_account_id: userAccountId,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
    });
    await tx.shift_template.update({
      where: { id },
      data: {
        updater_id: userId,
        user_account_id: userAccountId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
      },
    });
  });
}
export async function deleteShiftTemplate(ids: string[]): Promise<void> {
  await prisma.shift_template.deleteMany({ where: { id: { in: ids } } });
}
