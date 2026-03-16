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

export async function populateInventoryDependencies() {
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
  const product2 = await prisma.product.create({
    data: {
      code: `TEST-CODE-${Date.now()}`,
      name: 'Test Product',
      price: 100,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  return { product, product2 };
}

export async function populateInventoryData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const productItem = await prisma.product.create({
      data: {
        code: `TEST-CODE-${Date.now()}-${i}`,
        name: `Test Product ${i}`,
        price: 100,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    const record = await prisma.inventory.create({
      data: {
        product_id: productItem.id,
        quantity: Math.max(0, i * 100),
        reserved_quantity: Math.max(0, i * 100),
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateInventoryFullData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const productItem = await prisma.product.create({
      data: {
        code: `TEST-CODE-${Date.now()}-${i}`,
        name: `Test Product ${i}`,
        price: 100,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    const record = await prisma.inventory.create({
      data: {
        product_id: productItem.id,
        quantity: Math.max(0, i * 100),
        reserved_quantity: Math.max(0, i * 100),
        location: `Test Location ${i}`,
        lot_number: `Test Lot Number ${i}`,
        expiration_date: new Date(2025, 0, i).toISOString(),
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
