import { NextRequest, NextResponse } from 'next/server';
import { requireSession, handleApiError, ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';

/**
 * Moves a purchase_per_item line's reservation off its current inventory
 * lot(s) and re-reserves via the same allocation policy used for new orders
 * (x-reservation.policy.orderBy: expiration_date asc, lot_number asc, id asc).
 *
 * This is a Type2 move-cancel (correction_3_cancel_dual_purpose in
 * subtask_281n_gunshi.yaml) — ledger-only. Unlike the Type1 terminal cancel
 * in service_after_reject.ts, approvable/approval_request are never touched:
 * the line stays pending before and after the move.
 *
 * O-4: neither the un-reserve nor the re-reserve step touches physical
 * `quantity`, only `reserved_quantity`.
 * O-6: inventory has no direct FK from inventory_transaction; lots are
 * re-identified via denormalized fields (product_id/location/lot_number/expiration_date).
 * O-8: re-reservation may span multiple inventory lots — this is the native
 * multi-lot allocation loop, not a special case.
 */

class InsufficientInventoryMoveError extends Error {
  constructor(
    public available: number,
    public required: number,
  ) {
    super('Insufficient inventory to complete reservation move');
    this.name = 'InsufficientInventoryMoveError';
  }
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { userId: actorId } = await requireSession();
    const { id: purchaseOrderId } = await params;

    let body: { purchase_per_item_id?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, 'Invalid JSON body');
    }
    const purchasePerItemId = body.purchase_per_item_id;
    if (typeof purchasePerItemId !== 'string' || !purchasePerItemId) {
      throw new ApiError(400, 'purchase_per_item_id is required');
    }

    const item = await prisma.purchase_per_item.findFirst({
      where: { id: purchasePerItemId, purchase_order_id: purchaseOrderId },
      select: { id: true, inventory_transactionable_id: true },
    });
    if (!item) {
      throw new ApiError(404, 'purchase_per_item not found or does not belong to this purchase_order');
    }
    if (!item.inventory_transactionable_id) {
      throw new ApiError(400, 'purchase_per_item has no reservation to move');
    }
    const inventoryTransactionableId = item.inventory_transactionable_id;

    await prisma.$transaction(
      async (tx) => {
        const txs = await tx.inventory_transaction.findMany({
          where: { inventory_transactionable_id: inventoryTransactionableId },
        });

        // Net reserved_delta per inventory identity (O-6 denormalized fields;
        // O-8 multi-lot) — same netting pattern as service_after_reject.ts /
        // service_after_approve.ts.
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
        const activeReserves = [...netByInv.values()].filter((r) => r.net > 0);
        const totalQty = activeReserves.reduce((sum, r) => sum + r.net, 0);
        if (totalQty === 0) {
          throw new ApiError(400, 'No active reservation to move');
        }

        // Step 1: Type2 move-cancel — un-reserve every active lot. Ledger-only;
        // approvable/approval_request are never touched (line stays pending).
        for (const reserve of activeReserves) {
          // Phase4: inventory.location_id FK — denormalized name from the
          // ledger needs to be reverse-looked-up to a location_id before
          // re-identifying the inventory row.
          const reserveLocName = reserve.location === '' ? null : reserve.location;
          const reserveLoc = reserveLocName
            ? await tx.location.findFirst({ where: { name: reserveLocName } })
            : null;
          const inventoryCache = await tx.inventory.findFirst({
            where: {
              product_id: reserve.product_id,
              // O-6 denormalization writes location as '' for a null source
              // location; undo that for the lookup (same P1 fix as
              // service_after_reject.ts / service_after_approve.ts).
              location_id: reserveLoc?.id ?? null,
              lot_number: reserve.lot_number,
              expiration_date: reserve.expiration_date,
            },
          });
          await tx.inventory_transaction.create({
            data: {
              inventory_transactionable_id: inventoryTransactionableId,
              event_type: 'cancel', // Type2 move-cancel (not terminal reject)
              quantity_delta: 0, // O-4: cancel never touches physical inventory
              reserved_delta: -reserve.net,
              product_id: reserve.product_id,
              location: reserve.location,
              lot_number: reserve.lot_number,
              expiration_date: reserve.expiration_date,
              created_by_id: actorId,
              creator_id: actorId,
              updater_id: actorId,
            },
          });
          if (inventoryCache) {
            await tx.inventory.update({
              where: { id: inventoryCache.id },
              data: {
                reserved_quantity: { decrement: reserve.net },
                // quantity: unchanged (O-4)
              },
            });
          }
        }

        // Step 2: re-reserve via the same allocation policy as new-order
        // reservation (expiration_date asc, lot_number asc, id asc) — this
        // naturally spans multiple inventory lots (O-8).
        const productId = activeReserves[0].product_id;
        const availableInventories = await tx.inventory.findMany({
          where: { product_id: productId, quantity: { gt: 0 } },
          orderBy: [{ expiration_date: { sort: 'asc', nulls: 'last' } }, { lot_number: 'asc' }, { id: 'asc' }],
          include: { location: true },
        });

        let remaining = totalQty;
        for (const inv of availableInventories) {
          if (remaining <= 0) break;
          const available = inv.quantity - inv.reserved_quantity;
          if (available <= 0) continue;
          const allocQty = Math.min(available, remaining);

          await tx.inventory_transaction.create({
            data: {
              inventory_transactionable_id: inventoryTransactionableId,
              event_type: 'reserve',
              quantity_delta: 0, // O-4: reserve never touches physical inventory
              reserved_delta: allocQty,
              product_id: inv.product_id,
              location: inv.location?.name ?? '',
              lot_number: inv.lot_number,
              expiration_date: inv.expiration_date,
              created_by_id: actorId,
              creator_id: actorId,
              updater_id: actorId,
            },
          });
          await tx.inventory.update({
            where: { id: inv.id },
            data: { reserved_quantity: { increment: allocQty } },
          });
          remaining -= allocQty;
        }

        if (remaining > 0) {
          // Automatic rollback via prisma $transaction. approvable stays pending;
          // the caller is expected to split the line and retry with the smaller part.
          throw new InsufficientInventoryMoveError(totalQty - remaining, totalQty);
        }
        // approvable / approval_request: untouched — a move never changes approval state.
      },
      { isolationLevel: 'Serializable' },
    );

    return NextResponse.json({ message: 'Reservation moved successfully' });
  } catch (error) {
    if (error instanceof InsufficientInventoryMoveError) {
      return NextResponse.json(
        { code: 'INSUFFICIENT_INVENTORY', available: error.available, required: error.required },
        { status: 409 },
      );
    }
    return handleApiError(error);
  }
}
