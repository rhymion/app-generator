// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Phase5: inventory adjustment ledger write stub for inventory_adjustment
// x-ledger-source event_type: adjust
// Pattern: bridge create → entity update → inventory_transaction INSERT → inventory cache update

import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after inventory_adjustment approval is confirmed.
 * Creates 1 inventory_transaction row with quantity_delta from the adjustment.
 * quantity_delta may be positive (found stock) or negative (damaged/lost stock).
 */
export async function afterApprove(
  tx: Tx,
  entityId: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  const entity = await tx.inventory_adjustment.findFirst({
    where: { approvable_id: approvableId },
  });
  if (!entity) return;
  if (!entity.approvable_id) return;

  if (!entity.inventory_id) throw new Error('inventory_id required for ledger adjust write');

  if (entity.inventory_transactionable_id) {
    const existing = await tx.inventory_transaction.findFirst({
      where: { inventory_transactionable_id: entity.inventory_transactionable_id },
    });
    if (existing) return;
  }

  const bridge = entity.inventory_transactionable_id
    ? { id: entity.inventory_transactionable_id }
    : await tx.inventory_transactionable.create({ data: {} });

  if (!entity.inventory_transactionable_id) {
    await tx.inventory_adjustment.update({
      where: { id: entityId },
      data: { inventory_transactionable_id: bridge.id },
    });
  }

  const inventory = await tx.inventory.findUniqueOrThrow({
    where: { id: entity.inventory_id },
    include: { location: true },
  });

  const delta = entity.quantity_delta;

  await tx.inventory_transaction.create({
    data: {
      inventory_transactionable_id: bridge.id,
      event_type: 'adjust',
      quantity_delta: delta,
      reserved_delta: 0,
      product_id: inventory.product_id,
      location: inventory.location?.name ?? '',
      lot_number: inventory.lot_number,
      expiration_date: inventory.expiration_date,
      approved_via: approvableId,
      created_by_id: approvedByUserId,
      creator_id: approvedByUserId,
      updater_id: approvedByUserId,
    },
  });

  // increment accepts signed integers: positive adds, negative subtracts.
  await tx.inventory.update({
    where: { id: entity.inventory_id },
    data: { quantity: { increment: delta } },
  });
}
