// AUTO-GENERATED - DO NOT EDIT
import { prisma } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user_account.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populatePurchaseOrderDependencies() {
  const testUser = await getTestUser();
  const product = await prisma.product.create({
    data: {
      code: `TEST-CODE-${Date.now()}`,
      name: 'Test Product',
      price: 100,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  return { product };
}

export async function populatePurchaseOrderData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.purchase_order.create({
      data: {
        order_no: `Test Order No ${i}`,
        customer_id: testUser.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populatePurchaseOrderFullData = populatePurchaseOrderData;

export async function populatePurchaseOrderPurchasePerItemData(parentId: string, length: number) {
  const records = [];
  const deps = await populatePurchaseOrderDependencies();
  for (let i = 1; i <= length; i++) {
    const record = await prisma.purchase_per_item.create({
      data: {
        purchase_order_id: parentId,
        product_id: deps.product.id,
        quantity: Math.max(1, i * 100),
        price: Math.max(0, i * 100),
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
