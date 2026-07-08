// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)

import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after purchase_per_item's reservation is approved (ship — B-5 Phase2b
 * in-house ledger design).
 *
 * O-4: ship is the only path that touches physical `quantity` — it decrements
 * both `quantity` and `reserved_quantity` together (unlike reserve/cancel, which
 * only move `reserved_quantity`).
 * O-6: inventory has no direct FK from inventory_transaction; the cache row is
 * re-identified via denormalized fields (product_id/location/lot_number/expiration_date).
 * O-8: a line's reservation may span multiple inventory lots, so outstanding
 * reserved quantity is netted per lot from the full transaction history before
 * writing the ship row(s) — symmetric to service_after_reject.ts's cancel netting.
 *
 * @param tx - Prisma transaction client
 * @param entityId - ID of the approved purchase_per_item
 * @param approvableId - ID of the approvable record (unused: ship targets are
 *   found via the line's own inventory_transactionable_id, not the approvable)
 * @param approvedByUserId - ID of the user who approved (recorded on the ledger row)
 */
export async function afterApprove(
  tx: Tx,
  entityId: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  void approvableId;

  const item = await tx.purchase_per_item.findUnique({
    where: { id: entityId },
    select: { inventory_transactionable_id: true },
  });
  if (!item?.inventory_transactionable_id) return;

  const txs = await tx.inventory_transaction.findMany({
    where: { inventory_transactionable_id: item.inventory_transactionable_id },
  });

  // Net reserved_delta per inventory identity (O-6 denormalized fields; O-8 multi-lot).
  type NetEntry = {
    product_id: string;
    location: string;
    lot_number: string | null;
    expiration_date: Date | null;
    net: number;
  };
  const netByInv = new Map<string, NetEntry>();
  for (const t of txs) {
    const key = `${t.product_id}|${t.location}|${t.lot_number ?? ''}|${t.expiration_date?.toISOString() ?? ''}`;
    const existing = netByInv.get(key) ?? {
      product_id: t.product_id,
      location: t.location,
      lot_number: t.lot_number,
      expiration_date: t.expiration_date,
      net: 0,
    };
    existing.net += t.reserved_delta;
    netByInv.set(key, existing);
  }

  for (const reserve of netByInv.values()) {
    // Nothing outstanding to ship for this lot (already shipped/cancelled, or never reserved).
    if (reserve.net <= 0) continue;

    // Idempotency guard: a ship tx for this exact lot under this bridge already exists.
    const alreadyShipped = txs.some(
      (t) =>
        t.event_type === 'ship' &&
        t.product_id === reserve.product_id &&
        t.location === reserve.location &&
        t.lot_number === reserve.lot_number &&
        (t.expiration_date?.getTime() ?? null) === (reserve.expiration_date?.getTime() ?? null),
    );
    if (alreadyShipped) continue;

    await tx.inventory_transaction.create({
      data: {
        inventory_transactionable_id: item.inventory_transactionable_id,
        event_type: 'ship',
        quantity_delta: -reserve.net, // O-4: ship is the only path that decrements physical inventory
        reserved_delta: -reserve.net,
        product_id: reserve.product_id,
        location: reserve.location,
        lot_number: reserve.lot_number,
        expiration_date: reserve.expiration_date,
        created_by_id: approvedByUserId,
        creator_id: approvedByUserId,
        updater_id: approvedByUserId,
      },
    });

    const inventoryCache = await tx.inventory.findFirst({
      where: {
        product_id: reserve.product_id,
        // O-6 denormalization writes location as '' when the source inventory's
        // location is null (see lib/purchase_order/service.ts's `?? ''`); undo
        // that here so the re-identification lookup matches the real row.
        location: reserve.location === '' ? null : reserve.location,
        lot_number: reserve.lot_number,
        expiration_date: reserve.expiration_date,
      },
    });
    if (inventoryCache) {
      await tx.inventory.update({
        where: { id: inventoryCache.id },
        data: {
          quantity: { decrement: reserve.net }, // O-4: physical shipment
          reserved_quantity: { decrement: reserve.net }, // O-4: reservation released
        },
      });
    }
  }
}
