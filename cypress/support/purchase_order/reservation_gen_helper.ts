// AUTO-GENERATED - DO NOT EDIT
// x-reservation helper for entity: purchase_order

import { prisma } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

async function createTestProduct(testUser: any, suffix: string) {
  const attachable = await prisma.attachable.create({ data: {} });
  return prisma.product.create({
    data: {
      attachable_id: attachable.id,
      code: `GEN-PROD-${suffix}`,
      name: `Gen Product ${suffix}`,
      price: 0,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
}

async function createTestCustomer(testUser: any) {
  let record = await prisma.user.findFirst({
    where: { name: 'Gen PurchaseOrder Customer' },
    orderBy: { created_at: 'asc' },
  });
  if (!record) {
    record = await prisma.user.create({
      data: {
        name: 'Gen PurchaseOrder Customer',
        email: `gen-purchase_order-cust-${Date.now()}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  return record;
}

async function createPool(
  testUser: any,
  product_id: string,
  quantity: number,
  expiration_date: string | null = null,
  lot_number: string | null = null,
) {
  return prisma.inventory.create({
    data: {
      product_id,
      quantity,
      reserved_quantity: 0,
      creator_id: testUser.id,
      updater_id: testUser.id,
      expiration_date: expiration_date ? new Date(expiration_date) : null,
      lot_number: lot_number,
    },
  });
}

/** ① 複数アイテム引当成功: 同一 product_id で2行 inventory、十分な在庫 */
export async function seedReservationPurchaseOrderMulti() {
  const testUser = await getTestUser();
  const customer = await createTestCustomer(testUser);
  const product = await createTestProduct(testUser, 'MULTI-1');
  const inv1 = await createPool(testUser, product.id, 100, '2027-01-01', 'LOT-A');
  const inv2 = await createPool(testUser, product.id, 100, '2027-06-01', 'LOT-B');
  return JSON.parse(JSON.stringify({
    userId: customer.id,
    product,
    inventoryRows: [inv1, inv2],
  }));
}

/** ② 在庫不足 rollback: 必要数量を満たせない inventory */
export async function seedReservationPurchaseOrderInsufficient() {
  const testUser = await getTestUser();
  const customer = await createTestCustomer(testUser);
  const product = await createTestProduct(testUser, 'INSUF-1');
  const inventory = await createPool(testUser, product.id, 2);
  return JSON.parse(JSON.stringify({
    userId: customer.id,
    product,
    inventory,
    overQty: 5,
  }));
}

/** ③ criteria 遵守: 一致 product_id と不一致 product_id の inventory を混在 */
export async function seedReservationPurchaseOrderCriteria() {
  const testUser = await getTestUser();
  const customer = await createTestCustomer(testUser);
  const productMatch = await createTestProduct(testUser, 'CRIT-MATCH');
  const productNoMatch = await createTestProduct(testUser, 'CRIT-NOMATCH');
  const invMatch = await createPool(testUser, productMatch.id, 50);
  const invNoMatch = await createPool(testUser, productNoMatch.id, 50);
  return JSON.parse(JSON.stringify({
    userId: customer.id,
    productMatch,
    productNoMatch,
    invMatch,
    invNoMatch,
  }));
}

/** ④ orderBy 遵守: 同一 product_id で異なる orderBy フィールド値を持つ3行 inventory */
export async function seedReservationPurchaseOrderOrderBy() {
  const testUser = await getTestUser();
  const customer = await createTestCustomer(testUser);
  const product = await createTestProduct(testUser, 'ORDERBY-1');
  const inv1 = await createPool(testUser, product.id, 100, '2027-01-01', 'LOT-A');
  const inv2 = await createPool(testUser, product.id, 100, '2027-06-01', 'LOT-B');
  const inv3 = await createPool(testUser, product.id, 100, null, 'LOT-C');
  return JSON.parse(JSON.stringify({
    userId: customer.id,
    product,
    inventoryRows: [inv1, inv2, inv3],
  }));
}

/** Count inventory_allocation rows for a given purchase_order */
export async function countPurchaseOrderAllocations(parentId: string) {
  return prisma.inventory_allocation.count({
    where: { purchase_order_id: parentId },
  });
}

/** Get inventory by id (includes reserved_quantity) */
export async function getPurchaseOrderPoolState(poolId: string) {
  const row = await prisma.inventory.findUnique({ where: { id: poolId } });
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

/** Get inventory_allocation rows for a given purchase_order_id, with inventory included */
export async function getPurchaseOrderAllocationsOrdered(parentId: string) {
  const rows = await prisma.inventory_allocation.findMany({
    where: { purchase_order_id: parentId },
    include: { inventory: true },
    orderBy: [{ inventory: { expiration_date: 'asc' } }, { inventory: { lot_number: 'asc' } }, { inventory: { id: 'asc' } }],
  });
  return JSON.parse(JSON.stringify(rows));
}
