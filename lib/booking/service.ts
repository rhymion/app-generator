import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'booking'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    resource_id: normalizeValue(safeSnapshot.resource_id, 'string'),
    start_time: normalizeValue(safeSnapshot.start_time, 'date'),
    end_time: normalizeValue(safeSnapshot.end_time, 'date'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.booking.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addBooking(userId: string, name: string, resourceId: string, startTime: Date, endTime: Date): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      resource_id: resourceId,
      start_time: startTime,
      end_time: endTime,
    });
    const created = await tx.booking.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        resource_id: resourceId,
        start_time: startTime,
        end_time: endTime,
      },
    });
    return { id: created.id };
  });
}
export async function updateBooking(userId: string, id: string, name: string, resourceId: string, startTime: Date, endTime: Date, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      resource_id: resourceId,
      start_time: startTime,
      end_time: endTime,
    });
    await tx.booking.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        resource_id: resourceId,
        start_time: startTime,
        end_time: endTime,
      },
    });
  });
}
export async function deleteBooking(ids: string[]): Promise<void> {
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}
