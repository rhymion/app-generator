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
 * Retrieve the first inventory_allocation for a given purchase_order_id.
 */
export async function getInventoryAllocation(purchase_order_id: string) {
  const alloc = await prisma.inventory_allocation.findFirst({
    where: { purchase_order_id },
  });
  return alloc ? JSON.parse(JSON.stringify(alloc)) : null;
}
