import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';

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

export async function addBooking(creatorId: string, name: string, resourceId: string, startTime: Date, endTime: Date) {
  return await prisma.booking.create({
    data: {
      name: name,
      resource_id: resourceId,
      start_time: startTime,
      end_time: endTime,
      creator_id: creatorId,
    },
  });
}

export async function updateBooking(id: string, name: string, resourceId: string, startTime: Date, endTime: Date, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.booking.update({
      where: { id },
      data: {
      name: name,
      resource_id: resourceId,
      start_time: startTime,
      end_time: endTime,
      },
    });
  });
}

export async function deleteBooking(ids: string[]) {
  if (ids.length === 1) {
    await prisma.booking.delete({ where: { id: ids[0] } });
  } else {
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
}
