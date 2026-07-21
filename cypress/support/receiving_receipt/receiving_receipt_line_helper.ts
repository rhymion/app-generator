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
 * Single-role approval_flow + approver user, for the hand-written API-level
 * approval specs (approve/reject/dispatch/split). Renamed from
 * setupReceivingReceiptLineApprovalFlow to avoid colliding with the
 * generated (multi-flow) helper of that name under the same cy.task key —
 * the collision made this narrow one shadow the generated one everywhere,
 * including the generated UI spec (cmd_322 RC5).
 */
export async function setupReceivingReceiptLineSingleApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const approverRole = await prisma.role.create({
    data: { name: `Test Receiving Receipt Line Approver Role ${Date.now()}`, creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverUser = await prisma.user.create({
    data: {
      name: 'Test Receiving Receipt Line Approver User',
      email: `test-receiving_receipt_line-approver-${Date.now()}@example.com`,
      password: hashedPw,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });
  const flow = await prisma.approval_flow.create({
    data: {
      entity_name: 'receiving_receipt_line',
      requestor_role_id: null,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({ approverRole, approverUser, flow }));
}

/**
 * Directly seed a receiving_receipt + receiving_receipt_line (status=pending)
 * with a pending approval_request tied to its approvable_id, for the
 * hand-written API-level approval specs. Renamed from
 * populateReceivingReceiptLineWithApproval (was registered under the same
 * cy.task name as the generated helper of that name — same collision class
 * as setupReceivingReceiptLineApprovalFlow, cmd_322 RC5).
 */
export async function populateReceivingReceiptLineSingleApproval(
  creatorId: string,
  approvalFlowIds: string[],
  opts?: { inventoryId?: string | null; productId?: string },
) {
  const testUser = await getTestUser();
  // item3: callers that need the line's product to match a specific
  // inventory lot's product (e.g. split/approve tests exercising the
  // cross-product guard) pass productId instead of minting a fresh,
  // unrelated product.
  const product = opts?.productId
    ? await prisma.product.findUniqueOrThrow({ where: { id: opts.productId } })
    : await (async () => {
        const attachable = await prisma.attachable.create({ data: {} });
        return prisma.product.create({
          data: {
            attachable_id: attachable.id,
            code: `RRL-PROD-${Date.now()}`,
            name: 'Receiving Receipt Line Test Product',
            price: 50,
            creator_id: testUser.id,
            updater_id: testUser.id,
          },
        });
      })();

  const receipt = await prisma.receiving_receipt.create({
    data: {
      receipt_no: `RRL-${Date.now()}`,
      status: 0,
      creator_id: creatorId,
      updater_id: creatorId,
    },
  });

  const approvableItem = await prisma.approvable.create({ data: {} });
  const line = await prisma.receiving_receipt_line.create({
    data: {
      receiving_receipt_id: receipt.id,
      product_id: product.id,
      receipt_quantity: 5,
      status: 0,
      inventory_id: opts?.inventoryId ?? null,
      approvable_id: approvableItem.id,
    },
  });

  const approvalRequests = [];
  for (const flowId of approvalFlowIds) {
    const ar = await prisma.approval_request.create({
      data: { approvable_id: approvableItem.id, approval_flow_id: flowId, status: 0 },
    });
    approvalRequests.push(ar);
  }

  return JSON.parse(JSON.stringify({ receipt, line, product, approvalRequests }));
}

/**
 * Fetch a receiving_receipt_line row by id (cmd_296 split verification: parent
 * status/approvable_id after split, child field checks).
 */
export async function getReceivingReceiptLineById(id: string) {
  const line = await prisma.receiving_receipt_line.findUnique({ where: { id } });
  return JSON.parse(JSON.stringify(line));
}

/**
 * List receiving_receipt_line rows whose parent_id points at `parentId`
 * (cmd_296 split verification: child records created by the split action).
 */
export async function getReceivingReceiptLineChildren(parentId: string) {
  const children = await prisma.receiving_receipt_line.findMany({
    where: { parent_id: parentId },
    orderBy: { created_at: 'asc' },
  });
  return JSON.parse(JSON.stringify(children));
}
