// AUTO-GENERATED - DO NOT EDIT
import { prisma, ALL_ENTITIES } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populateReceivingReceiptDependencies() {
  const testUser = await getTestUser();
  const purchaseOrderRecord = await prisma.receiving_purchase_order.create({
    data: {
      order_no: 'Test Order No',
      status: 'Test Status',
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const purchaseOrder = { ...purchaseOrderRecord, name: (purchaseOrderRecord.order_no ?? '') };
  const asnRecord = await prisma.receiving_asn.create({
    data: {
      asn_no: 'Test Asn No',
      status: 'Test Status',
      purchase_order_id: purchaseOrder.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const asn = { ...asnRecord, name: (asnRecord.asn_no ?? '') };
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let productRecord = await prisma.product.findFirst({
    where: { name: 'Test Product' },
    orderBy: { created_at: 'asc' },
  });
  if (!productRecord) {
    const productAttachable = await prisma.attachable.create({ data: {} });
    productRecord = await prisma.product.create({
      data: {
        attachable_id: productAttachable.id,
        code: 'Test Code',
        name: 'Test Product',
        price: 0,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  const product = productRecord;
  return { purchaseOrder, asn, product, receivingPurchaseOrder: purchaseOrder, receivingAsn: asn };
}

export async function populateReceivingReceiptData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.receiving_receipt.create({
      data: {
        receipt_no: `Test Receipt No ${i}`,
        status: 'draft',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateReceivingReceiptFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateReceivingReceiptDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.receiving_receipt.create({
      data: {
        receipt_no: `Test Receipt No ${i}`,
        purchase_order_id: deps.purchaseOrder.id,
        asn_id: deps.asn.id,
        status: 'draft',
        confirmed_at: new Date(2025, 0, i, 9, 0).toISOString(),
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateReceivingReceiptReceivingReceiptLineData(parentId: string, length: number) {
  const records = [];
  const deps = await populateReceivingReceiptDependencies();
  for (let i = 1; i <= length; i++) {
    const record = await prisma.receiving_receipt_line.create({
      data: {
        receiving_receipt_id: parentId,
        product_id: deps.product.id,
        receipt_quantity: Math.max(0, i * 100),
        done_quantity: Math.max(0, i * 100),
        cancelled_quantity: Math.max(0, i * 100),
        outstanding_quantity: Math.max(0, i * 100),
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
