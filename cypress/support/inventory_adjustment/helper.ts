// AUTO-GENERATED - DO NOT EDIT
import { prisma, ALL_ENTITIES } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';
import { formatLabelValue } from '@/lib/_format';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populateInventoryAdjustmentDependencies() {
  const testUser = await getTestUser();
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
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let locationRecord = await prisma.location.findFirst({
    where: { name: 'Test Location' },
    orderBy: { created_at: 'asc' },
  });
  if (!locationRecord) {
    locationRecord = await prisma.location.create({
      data: {
        name: 'Test Location',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  const location = locationRecord;
  const inventoryRecord = await prisma.inventory.create({
    data: {
      quantity: 0,
      product_id: product.id,
      location_id: location.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
    include: { product: true, location: true },
  });
  const inventory = { ...inventoryRecord, name: `${(inventoryRecord.product?.name ?? '')} ${(inventoryRecord.location?.name ?? '')} ${(inventoryRecord.lot_number ?? '')} ${formatLabelValue(inventoryRecord.expiration_date, 'date')}`, searchName: `${(inventoryRecord.product?.name ?? '')} ${(inventoryRecord.location?.name ?? '')} ${(inventoryRecord.lot_number ?? '')}` };
  return { product, location, inventory };
}

export async function populateInventoryAdjustmentData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateInventoryAdjustmentDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const approvableItem = await prisma.approvable.create({ data: {} });
    const record = await prisma.inventory_adjustment.create({
      data: {
        approvable_id: approvableItem.id,
        inventory_id: deps.inventory.id,
        quantity_delta: i * 100,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateInventoryAdjustmentFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateInventoryAdjustmentDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const approvableItem = await prisma.approvable.create({ data: {} });
    const record = await prisma.inventory_adjustment.create({
      data: {
        approvable_id: approvableItem.id,
        inventory_id: deps.inventory.id,
        quantity_delta: i * 100,
        reason: `Test Reason ${i}`,
        status: 'pending',
        inventory_transactionable_id: `Test Inventory Transactionable Id ${i}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function setupInventoryAdjustmentApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const requestorRole = await prisma.role.create({
    data: { name: 'Test Inventory Adjustment Requestor Role', creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverRole = await prisma.role.create({
    data: { name: 'Test Inventory Adjustment Approver Role', creator_id: testUser.id, updater_id: testUser.id },
  });
  // noRoleUser needs entity permission to access inventory_adjustment but must NOT hold
  // requestorRole/approverRole (so the role-gated approval flow is skipped for them).
  const basicRole = await prisma.role.create({
    data: { name: 'Test Inventory Adjustment Basic Role', creator_id: testUser.id, updater_id: testUser.id },
  });

  // Grant all entity permissions to each role so approval-flow users can access
  // the entity form and all FK-dependent autocompletes (authz uses default-deny).
  await Promise.all(
    [requestorRole, approverRole, basicRole].flatMap(role =>
      ALL_ENTITIES.map(entity =>
        prisma.permission.create({
          data: {
            name: entity,
            role_id: role.id,
            create: true,
            read: true,
            update: true,
            delete: true,
            creator_id: testUser.id,
            updater_id: testUser.id,
          },
        })
      )
    )
  );

  const requestorUser = await prisma.user.create({
    data: {
      name: 'Test Inventory Adjustment Requestor User',
      email: 'test-inventory_adjustment-requestor@example.com',
      password: hashedPw,
      api_key: `test_mk_inventory_adjustment_requestor`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: requestorRole.id }] },
    },
  });

  const approverUser = await prisma.user.create({
    data: {
      name: 'Test Inventory Adjustment Approver User',
      email: 'test-inventory_adjustment-approver@example.com',
      password: hashedPw,
      api_key: `test_mk_inventory_adjustment_approver`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });

  const noRoleUser = await prisma.user.create({
    data: {
      name: 'Test Inventory Adjustment No Role User',
      email: 'test-inventory_adjustment-norole@example.com',
      password: hashedPw,
      api_key: `test_mk_inventory_adjustment_norole`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: basicRole.id }] },
    },
  });

  const flowWithRole = await prisma.approval_flow.create({
    data: {
      entity_name: 'inventory_adjustment',
      requestor_role_id: requestorRole.id,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  const flowWithoutRole = await prisma.approval_flow.create({
    data: {
      entity_name: 'inventory_adjustment',
      requestor_role_id: null,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({
    requestorRole,
    approverRole,
    requestorUser,
    approverUser,
    noRoleUser,
    flowWithRole,
    flowWithoutRole,
  }));
}

export async function setupInventoryAdjustmentOrderedApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const approverRole1 = await prisma.role.create({
    data: { name: 'Test Inventory Adjustment Ordered Approver Role 1', creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverRole2 = await prisma.role.create({
    data: { name: 'Test Inventory Adjustment Ordered Approver Role 2', creator_id: testUser.id, updater_id: testUser.id },
  });

  // Grant all entity permissions to each approver role so they can access the
  // entity and all FK-dependent autocompletes (authz uses default-deny).
  await Promise.all(
    [approverRole1, approverRole2].flatMap(role =>
      ALL_ENTITIES.map(entity =>
        prisma.permission.create({
          data: {
            name: entity,
            role_id: role.id,
            create: true,
            read: true,
            update: true,
            delete: true,
            creator_id: testUser.id,
            updater_id: testUser.id,
          },
        })
      )
    )
  );

  const approverUser1 = await prisma.user.create({
    data: {
      name: 'Test Inventory Adjustment Ordered Approver 1',
      email: 'test-inventory_adjustment-ordered-approver1@example.com',
      password: hashedPw,
      api_key: `test_mk_inventory_adjustment_ordered_approver1`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole1.id }] },
    },
  });
  const approverUser2 = await prisma.user.create({
    data: {
      name: 'Test Inventory Adjustment Ordered Approver 2',
      email: 'test-inventory_adjustment-ordered-approver2@example.com',
      password: hashedPw,
      api_key: `test_mk_inventory_adjustment_ordered_approver2`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole2.id }] },
    },
  });

  const flow1 = await prisma.approval_flow.create({
    data: {
      entity_name: 'inventory_adjustment',
      approver_role_id: approverRole1.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const flow2 = await prisma.approval_flow.create({
    data: {
      entity_name: 'inventory_adjustment',
      approver_role_id: approverRole2.id,
      preceded_by: { connect: [{ id: flow1.id }] },
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({ flow1, flow2, approverUser1, approverUser2 }));
}

export async function populateInventoryAdjustmentWithRejectedApproval(creatorId: string, approvalFlowIds: string[]) {
  const testUser = await getTestUser();
  const deps = await populateInventoryAdjustmentDependencies();
  const approvableItem = await prisma.approvable.create({ data: {} });
  const record = await prisma.inventory_adjustment.create({
    data: {
      approvable_id: approvableItem.id,
      inventory_id: deps.inventory.id,
      quantity_delta: 1 * 100,
      creator_id: creatorId,
      updater_id: creatorId,
    },
  });
  const approvalRequests = [];
  for (const flowId of approvalFlowIds) {
    const ar = await prisma.approval_request.create({
      data: { approvable_id: approvableItem.id, approval_flow_id: flowId, status: 2 },
    });
    approvalRequests.push(ar);
  }
  return JSON.parse(JSON.stringify({ record, approvalRequests }));
}

export async function populateInventoryAdjustmentWithTerminalRejectedApproval(creatorId: string, approvalFlowIds: string[]) {
  const testUser = await getTestUser();
  const deps = await populateInventoryAdjustmentDependencies();
  const approvableItem = await prisma.approvable.create({ data: {} });
  const record = await prisma.inventory_adjustment.create({
    data: {
      approvable_id: approvableItem.id,
      inventory_id: deps.inventory.id,
      quantity_delta: 1 * 100,
      creator_id: creatorId,
      updater_id: creatorId,
    },
  });
  const approvalRequests = [];
  for (const flowId of approvalFlowIds) {
    const ar = await prisma.approval_request.create({
      data: { approvable_id: approvableItem.id, approval_flow_id: flowId, status: 3 },
    });
    approvalRequests.push(ar);
  }
  return JSON.parse(JSON.stringify({ record, approvalRequests }));
}

export async function populateInventoryAdjustmentWithApproval(creatorId: string, approvalFlowIds: string[]) {
  const testUser = await getTestUser();
  const deps = await populateInventoryAdjustmentDependencies();
  const approvableItem = await prisma.approvable.create({ data: {} });
  const record = await prisma.inventory_adjustment.create({
    data: {
      approvable_id: approvableItem.id,
      inventory_id: deps.inventory.id,
      quantity_delta: 1 * 100,
      creator_id: creatorId,
      updater_id: creatorId,
    },
  });
  const approvalRequests = [];
  for (const flowId of approvalFlowIds) {
    const ar = await prisma.approval_request.create({
      data: { approvable_id: approvableItem.id, approval_flow_id: flowId, status: 0 },
    });
    approvalRequests.push(ar);
  }
  return JSON.parse(JSON.stringify({ record, approvalRequests }));
}
