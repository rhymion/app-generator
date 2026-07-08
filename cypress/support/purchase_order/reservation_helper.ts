import { prisma } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

/**
 * Seed a product + inventory row with a specific quantity, plus a customer.
 * Returns { product, inventory, customer } for use in reservation Cypress tests.
 */
export async function seedReservationInventory(quantity: number) {
  const testUser = await getTestUser();

  let productRecord = await prisma.product.findFirst({
    where: { name: 'Reservation Test Product' },
    orderBy: { created_at: 'asc' },
  });
  if (!productRecord) {
    const attachable = await prisma.attachable.create({ data: {} });
    productRecord = await prisma.product.create({
      data: {
        attachable_id: attachable.id,
        code: 'RES-PROD-001',
        name: 'Reservation Test Product',
        price: 100,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }

  // Always create a fresh inventory row with the requested quantity
  const inventoryRecord = await prisma.inventory.create({
    data: {
      product_id: productRecord.id,
      quantity,
      reserved_quantity: 0,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  let customerRecord = await prisma.user.findFirst({
    where: { name: 'Reservation Test Customer' },
    orderBy: { created_at: 'asc' },
  });
  if (!customerRecord) {
    customerRecord = await prisma.user.create({
      data: {
        name: 'Reservation Test Customer',
        email: `res-customer-${Date.now()}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }

  return JSON.parse(JSON.stringify({
    product: productRecord,
    inventory: inventoryRecord,
    customer: customerRecord,
  }));
}

/**
 * Reconstruct the reservation for a given purchase_order_id from the
 * inventory_transaction ledger (B-5 Phase2: inventory_allocation was removed —
 * O-2/O-6/O-8. See afterReject/afterApprove for the same netting pattern).
 *
 * Returns a shape compatible with the old inventory_allocation row
 * ({ quantity, inventory_id }) for the single-lot reservations exercised by
 * these tests; `quantity` is the net outstanding reserved amount summed
 * across all lots (O-8), and `inventory_id` identifies the first active lot.
 */
export async function getInventoryAllocation(purchase_order_id: string) {
  const item = await prisma.purchase_per_item.findFirst({
    where: { purchase_order_id, inventory_transactionable_id: { not: null } },
  });
  if (!item?.inventory_transactionable_id) return null;

  const txs = await prisma.inventory_transaction.findMany({
    where: { inventory_transactionable_id: item.inventory_transactionable_id },
  });
  if (txs.length === 0) return null;

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

  const active = [...netByInv.values()].filter((r) => r.net > 0);
  if (active.length === 0) return null;

  const quantity = active.reduce((sum, r) => sum + r.net, 0);
  const first = active[0];
  const inventoryCache = await prisma.inventory.findFirst({
    where: {
      product_id: first.product_id,
      // O-6 denormalization writes location as '' when the source inventory's
      // location is null (see lib/purchase_order/service.ts's `?? ''`); undo
      // that here so the reverse lookup can still match the row.
      location: first.location === '' ? null : first.location,
      lot_number: first.lot_number,
      expiration_date: first.expiration_date,
    },
  });

  return JSON.parse(JSON.stringify({
    quantity,
    inventory_id: inventoryCache?.id ?? null,
    inventory_transactionable_id: item.inventory_transactionable_id,
  }));
}

/**
 * Create an approval_flow for purchase_per_item's terminal-reject-driven
 * reservation cancel path (B-5 Phase2c D7 tests), plus an approver user/role
 * to exercise the reject action.
 */
export async function setupPurchasePerItemApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const approverRole = await prisma.role.create({
    data: { name: `Test Purchase Per Item Approver Role ${Date.now()}`, creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverUser = await prisma.user.create({
    data: {
      name: 'Test Purchase Per Item Approver User',
      email: `test-purchase_per_item-approver-${Date.now()}@example.com`,
      password: hashedPw,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });
  // requestor_role_id: null so any creator (e.g. the default TEST_API_KEY user)
  // satisfies the flow's requestor gate in purchase_order/service.ts.
  const flow = await prisma.approval_flow.create({
    data: {
      entity_name: 'purchase_per_item',
      requestor_role_id: null,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({ approverRole, approverUser, flow }));
}

/**
 * Retrieve the purchase_per_item row(s) for a given purchase_order_id,
 * including the fields needed to locate its approvable/approval_request and
 * inventory_transaction ledger (approvable_id, inventory_transactionable_id).
 */
export async function getPurchasePerItemsForOrder(purchase_order_id: string) {
  const items = await prisma.purchase_per_item.findMany({
    where: { purchase_order_id },
  });
  return JSON.parse(JSON.stringify(items));
}
