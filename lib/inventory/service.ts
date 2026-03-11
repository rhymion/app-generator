import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'inventory'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    product_id: normalizeValue(safeSnapshot.product_id, 'string'),
    quantity: normalizeValue(safeSnapshot.quantity, 'number'),
    reserved_quantity: normalizeValue(safeSnapshot.reserved_quantity, 'number'),
    location: normalizeValue(safeSnapshot.location, 'string'),
    lot_number: normalizeValue(safeSnapshot.lot_number, 'string'),
    expiration_date: normalizeValue(safeSnapshot.expiration_date, 'date'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.inventory.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addInventory(userId: string, productId: string, quantity: number, reservedQuantity: number, location: string | null, lotNumber: string | null, expirationDate: Date | null): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      product_id: productId,
      quantity: quantity,
      reserved_quantity: reservedQuantity,
      location: location,
      lot_number: lotNumber,
      expiration_date: expirationDate,
    });
    const created = await tx.inventory.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        product_id: productId,
        quantity: quantity,
        reserved_quantity: reservedQuantity,
        location: location,
        lot_number: lotNumber,
        expiration_date: expirationDate,
      },
    });
    return { id: created.id };
  });
}
export async function updateInventory(userId: string, id: string, productId: string, quantity: number, reservedQuantity: number, location: string | null, lotNumber: string | null, expirationDate: Date | null, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      product_id: productId,
      quantity: quantity,
      reserved_quantity: reservedQuantity,
      location: location,
      lot_number: lotNumber,
      expiration_date: expirationDate,
    });
    await tx.inventory.update({
      where: { id },
      data: {
        updater_id: userId,
        product_id: productId,
        quantity: quantity,
        reserved_quantity: reservedQuantity,
        location: location,
        lot_number: lotNumber,
        expiration_date: expirationDate,
      },
    });
  });
}
export async function deleteInventory(ids: string[]): Promise<void> {
  await prisma.inventory.deleteMany({ where: { id: { in: ids } } });
}
