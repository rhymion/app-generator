// B-5 Phase2b (G9): backfill inventory_allocation rows into the inventory_transaction
// ledger before the table is dropped by the follow-up `prisma migrate dev
// --name remove_inventory_allocation` (G10). PD-3: this script MUST run first —
// dropping the table before backfilling loses the reservation history it holds.
//
// Test/dev environments normally use `prisma db push`, which just deletes the
// table outright — fine there since the table only ever holds throwaway seed
// data. This script exists for any environment where inventory_allocation rows
// represent real, in-flight reservations that must survive the cutover
// (mirrors scripts/migrations/01_user_tenant_id.sql's rationale).
//
// inventory_allocation has already been removed from schema.prisma (Phase2a
// G2), so there is no Prisma model for it here — the old table is read via
// raw SQL and still physically exists until G10 runs.
//
// Usage:
//   npx tsx scripts/migrations/02_inventory_allocation_to_ledger.ts --dry-run
//   npx tsx scripts/migrations/02_inventory_allocation_to_ledger.ts
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is required. Set NODE_ENV=test for test defaults, or create .env.local for local secrets.'
  );
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');

type OldAllocationRow = {
  id: string;
  purchase_order_id: string;
  purchase_per_item_id: string;
  inventory_id: string;
  quantity: number;
  remaining_quantity: number;
  status: number;
  creator_id: string;
  updater_id: string;
  created_at: Date;
};

async function main() {
  const rows = await prisma.$queryRaw<OldAllocationRow[]>`
    SELECT id, purchase_order_id, purchase_per_item_id, inventory_id, quantity, remaining_quantity, status, creator_id, updater_id, created_at
    FROM inventory_allocation
    ORDER BY created_at ASC
  `;

  console.log(`Found ${rows.length} inventory_allocation row(s).`);
  if (rows.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  // O-4/R1 invariant (docs/generic-primitives-redesign.md A-6/A-5): going
  // forward, inventory.reserved_quantity = SUM(reserved_delta). remaining_quantity
  // — not the original quantity — is what's still actually held against
  // inventory.reserved_quantity today (ship/release/cancel already consumed the
  // rest under the old conditional_update code path, and that's not being
  // replayed here). So each row backfills a single 'reserve' ledger entry sized
  // at remaining_quantity; fully consumed rows (remaining_quantity=0 — shipped,
  // released, or cancelled) contribute nothing and are skipped.
  const migratable = rows.filter((r) => r.remaining_quantity > 0);
  const fullyConsumed = rows.length - migratable.length;

  // One bridge (inventory_transactionable) per purchase_per_item line, shared
  // across all of that line's allocation rows (O-2 bridge / O-8 multi-lot).
  const byItem = new Map<string, OldAllocationRow[]>();
  for (const row of migratable) {
    const list = byItem.get(row.purchase_per_item_id) ?? [];
    list.push(row);
    byItem.set(row.purchase_per_item_id, list);
  }

  // Pre-migration source of truth for the SUM check below: total *outstanding*
  // (remaining_quantity) reserved per physical inventory row, taken straight
  // from the old table — this is what inventory.reserved_quantity already
  // reflects today, and what the new ledger's reserve total must match.
  const expectedByInventoryId = new Map<string, number>();
  for (const row of migratable) {
    expectedByInventoryId.set(
      row.inventory_id,
      (expectedByInventoryId.get(row.inventory_id) ?? 0) + row.remaining_quantity
    );
  }

  let migratedRows = 0;
  let skippedItems = 0;

  for (const [purchasePerItemId, allocations] of byItem) {
    const totalRemaining = allocations.reduce((sum, a) => sum + a.remaining_quantity, 0);
    const item = await prisma.purchase_per_item.findUnique({
      where: { id: purchasePerItemId },
      select: { id: true, inventory_transactionable_id: true },
    });
    if (!item) {
      console.warn(
        `purchase_per_item ${purchasePerItemId} not found — skipping ${allocations.length} allocation row(s) (remaining=${totalRemaining}).`
      );
      skippedItems++;
      continue;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}purchase_per_item=${purchasePerItemId}: ` +
      `${allocations.length} allocation row(s), total remaining_quantity=${totalRemaining}`
    );
    if (DRY_RUN) continue;

    await prisma.$transaction(async (tx) => {
      const bridgeId =
        item.inventory_transactionable_id ?? (await tx.inventory_transactionable.create({ data: {} })).id;

      for (const alloc of allocations) {
        const inv = await tx.inventory.findUnique({
          where: { id: alloc.inventory_id },
          include: { location: true },
        });
        if (!inv) {
          throw new Error(`inventory ${alloc.inventory_id} referenced by inventory_allocation ${alloc.id} not found`);
        }

        await tx.inventory_transaction.create({
          data: {
            inventory_transactionable_id: bridgeId,
            event_type: 'reserve',
            quantity_delta: 0, // O-4: reserve never touches physical quantity
            reserved_delta: alloc.remaining_quantity, // outstanding amount only (see comment above)
            product_id: inv.product_id,
            location: inv.location?.name ?? '',
            lot_number: inv.lot_number,
            expiration_date: inv.expiration_date,
            created_by_id: alloc.creator_id,
            creator_id: alloc.creator_id,
            updater_id: alloc.updater_id,
            created_at: alloc.created_at,
          },
        });
        migratedRows++;
      }

      if (!item.inventory_transactionable_id) {
        await tx.purchase_per_item.update({
          where: { id: purchasePerItemId },
          data: { inventory_transactionable_id: bridgeId },
        });
      }
    });
  }

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Done. ${DRY_RUN ? 'Would migrate' : 'Migrated'} ${migratable.length} row(s) ` +
    `across ${byItem.size} purchase_per_item line(s) (${skippedItems} skipped: line no longer exists; ` +
    `${fullyConsumed} skipped: fully shipped/released/cancelled, nothing outstanding).`
  );

  if (DRY_RUN) return;

  // SUM verification (PD-3): for every inventory row touched, the new ledger's
  // net reserved_delta for that inventory identity must equal the old table's
  // summed remaining_quantity (the outstanding amount, not the original
  // quantity — see comment above). A mismatch means data was dropped or
  // double-counted.
  let mismatches = 0;
  for (const [inventoryId, expectedSum] of expectedByInventoryId) {
    const inv = await prisma.inventory.findUnique({
      where: { id: inventoryId },
      include: { location: true },
    });
    if (!inv) continue; // inventory row itself no longer exists — nothing to reconcile
    const agg = await prisma.inventory_transaction.aggregate({
      _sum: { reserved_delta: true },
      where: {
        event_type: 'reserve',
        product_id: inv.product_id,
        location: inv.location?.name ?? '',
        lot_number: inv.lot_number,
        expiration_date: inv.expiration_date,
      },
    });
    const actualSum = agg._sum.reserved_delta ?? 0;
    if (actualSum !== expectedSum) {
      mismatches++;
      console.error(`SUM MISMATCH inventory=${inventoryId}: expected ${expectedSum}, got ${actualSum}`);
    }
  }
  if (mismatches > 0) {
    throw new Error(`SUM verification failed: ${mismatches} inventory row(s) mismatched.`);
  }
  console.log(`SUM verification passed: ${expectedByInventoryId.size} inventory row(s) reconciled, ${migratedRows} ledger row(s) written.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
