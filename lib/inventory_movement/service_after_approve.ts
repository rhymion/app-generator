// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Phase5: inventory movement ledger write stub for inventory_movement
// x-ledger-source event_type: move
// Pattern: bridge create → entity update → 2x inventory_transaction INSERT → 2x inventory cache update

import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after inventory_movement approval is confirmed.
 * Creates 2 inventory_transaction rows (OD-7: single entity, 2 ledger rows):
 *   - from-pool row: quantity_delta = -N (debit)
 *   - to-pool row:   quantity_delta = +N (credit)
 * Both rows share one inventory_transactionable bridge (same movement event).
 */
export async function afterApprove(
  tx: Tx,
  entityId: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  const entity = await tx.inventory_movement.findFirst({
    where: { approvable_id: approvableId },
  });
  if (!entity) return;
  if (!entity.approvable_id) return;

  if (!entity.from_inventory_id) throw new Error('from_inventory_id required for ledger move write');
  if (!entity.to_inventory_id) throw new Error('to_inventory_id required for ledger move write');

  // Idempotency guard: if bridge exists, check for existing transactions.
  if (entity.inventory_transactionable_id) {
    const existing = await tx.inventory_transaction.findFirst({
      where: { inventory_transactionable_id: entity.inventory_transactionable_id },
    });
    if (existing) return;
  }

  // Step 1: Create shared bridge (one bridge for both debit+credit rows).
  const bridge = entity.inventory_transactionable_id
    ? { id: entity.inventory_transactionable_id }
    : await tx.inventory_transactionable.create({ data: {} });

  // Step 2: Link bridge to entity (if newly created).
  if (!entity.inventory_transactionable_id) {
    await tx.inventory_movement.update({
      where: { id: entityId },
      data: { inventory_transactionable_id: bridge.id },
    });
  }

  // Step 3: Fetch both inventory pools with their location for denormalized copy.
  const fromInventory = await tx.inventory.findUniqueOrThrow({
    where: { id: entity.from_inventory_id },
    include: { location: true },
  });
  const toInventory = await tx.inventory.findUniqueOrThrow({
    where: { id: entity.to_inventory_id },
    include: { location: true },
  });

  const qty = entity.quantity;

  // Step 4a: Debit row — from-pool loses quantity.
  await tx.inventory_transaction.create({
    data: {
      inventory_transactionable_id: bridge.id,
      event_type: 'move',
      quantity_delta: -qty,
      reserved_delta: 0,
      product_id: fromInventory.product_id,
      location: fromInventory.location?.name ?? '',
      lot_number: fromInventory.lot_number,
      expiration_date: fromInventory.expiration_date,
      approved_via: approvableId,
      created_by_id: approvedByUserId,
      creator_id: approvedByUserId,
      updater_id: approvedByUserId,
    },
  });

  // Step 4b: Credit row — to-pool gains quantity.
  await tx.inventory_transaction.create({
    data: {
      inventory_transactionable_id: bridge.id,
      event_type: 'move',
      quantity_delta: +qty,
      reserved_delta: 0,
      product_id: toInventory.product_id,
      location: toInventory.location?.name ?? '',
      lot_number: toInventory.lot_number,
      expiration_date: toInventory.expiration_date,
      approved_via: approvableId,
      created_by_id: approvedByUserId,
      creator_id: approvedByUserId,
      updater_id: approvedByUserId,
    },
  });

  // Step 5: Update inventory caches (materialized SUM).
  await tx.inventory.update({
    where: { id: entity.from_inventory_id },
    data: { quantity: { decrement: qty } },
  });
  await tx.inventory.update({
    where: { id: entity.to_inventory_id },
    data: { quantity: { increment: qty } },
  });
}
