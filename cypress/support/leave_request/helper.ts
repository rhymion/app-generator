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

export async function populateLeaveRequestDependencies() {
  const testUser = await getTestUser();
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let userRecord = await prisma.user.findFirst({
    where: { name: 'Test User' },
    orderBy: { created_at: 'asc' },
  });
  if (!userRecord) {
    userRecord = await prisma.user.create({
      data: {
        name: 'Test User',
        email: `test-user-${Date.now()}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  const user = userRecord;
  return { user };
}

export async function populateLeaveRequestData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const userItem = await prisma.user.create({
      data: {
        name: `Test User ${i}`,
        email: `test-user-${Date.now()}-${i}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    const approvableItem = await prisma.approvable.create({ data: {} });
    const record = await prisma.leave_request.create({
      data: {
        approvable_id: approvableItem.id,
        start_date: new Date(Date.UTC(2025, 0, i)).toISOString(),
        end_date: new Date(Date.UTC(2025, 0, i)).toISOString(),
        reason: `Test Reason ${i}`,
        user_id: userItem.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateLeaveRequestFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateLeaveRequestDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const userItem = await prisma.user.create({
      data: {
        name: `Test User ${i}`,
        email: `test-user-${Date.now()}-${i}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    const approvableItem = await prisma.approvable.create({ data: {} });
    const record = await prisma.leave_request.create({
      data: {
        approvable_id: approvableItem.id,
        start_date: new Date(Date.UTC(2025, 0, i)).toISOString(),
        end_date: new Date(Date.UTC(2025, 0, i)).toISOString(),
        reason: `Test Reason ${i}`,
        status: 'pending',
        user_id: userItem.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function setupLeaveRequestApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const requestorRole = await prisma.role.create({
    data: { name: 'Test Leave Request Requestor Role', creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverRole = await prisma.role.create({
    data: { name: 'Test Leave Request Approver Role', creator_id: testUser.id, updater_id: testUser.id },
  });
  // noRoleUser needs entity permission to access leave_request but must NOT hold
  // requestorRole/approverRole (so the role-gated approval flow is skipped for them).
  const basicRole = await prisma.role.create({
    data: { name: 'Test Leave Request Basic Role', creator_id: testUser.id, updater_id: testUser.id },
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
      name: 'Test Leave Request Requestor User',
      email: 'test-leave_request-requestor@example.com',
      password: hashedPw,
      api_key: `test_mk_leave_request_requestor`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: requestorRole.id }] },
    },
  });

  const approverUser = await prisma.user.create({
    data: {
      name: 'Test Leave Request Approver User',
      email: 'test-leave_request-approver@example.com',
      password: hashedPw,
      api_key: `test_mk_leave_request_approver`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });

  const noRoleUser = await prisma.user.create({
    data: {
      name: 'Test Leave Request No Role User',
      email: 'test-leave_request-norole@example.com',
      password: hashedPw,
      api_key: `test_mk_leave_request_norole`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: basicRole.id }] },
    },
  });

  const flowWithRole = await prisma.approval_flow.create({
    data: {
      entity_name: 'leave_request',
      requestor_role_id: requestorRole.id,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  const flowWithoutRole = await prisma.approval_flow.create({
    data: {
      entity_name: 'leave_request',
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

export async function setupLeaveRequestOrderedApprovalFlow() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const approverRole1 = await prisma.role.create({
    data: { name: 'Test Leave Request Ordered Approver Role 1', creator_id: testUser.id, updater_id: testUser.id },
  });
  const approverRole2 = await prisma.role.create({
    data: { name: 'Test Leave Request Ordered Approver Role 2', creator_id: testUser.id, updater_id: testUser.id },
  });

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
      name: 'Test Leave Request Ordered Approver 1',
      email: 'test-leave_request-ordered-approver1@example.com',
      password: hashedPw,
      api_key: `test_mk_leave_request_ordered_approver1`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole1.id }] },
    },
  });
  const approverUser2 = await prisma.user.create({
    data: {
      name: 'Test Leave Request Ordered Approver 2',
      email: 'test-leave_request-ordered-approver2@example.com',
      password: hashedPw,
      api_key: `test_mk_leave_request_ordered_approver2`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole2.id }] },
    },
  });

  const flow1 = await prisma.approval_flow.create({
    data: {
      entity_name: 'leave_request',
      approver_role_id: approverRole1.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const flow2 = await prisma.approval_flow.create({
    data: {
      entity_name: 'leave_request',
      approver_role_id: approverRole2.id,
      preceded_by: { connect: [{ id: flow1.id }] },
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({ flow1, flow2, approverUser1, approverUser2 }));
}

export async function populateLeaveRequestWithRejectedApproval(creatorId: string, approvalFlowIds: string[]) {
  const testUser = await getTestUser();
  const approvableItem = await prisma.approvable.create({ data: {} });
  const record = await prisma.leave_request.create({
    data: {
      approvable_id: approvableItem.id,
      start_date: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      end_date: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      reason: `Test Reason ${1}`,
      user_id: testUser.id,
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

export async function populateLeaveRequestWithApproval(creatorId: string, approvalFlowIds: string[]) {
  const testUser = await getTestUser();
  const approvableItem = await prisma.approvable.create({ data: {} });
  const record = await prisma.leave_request.create({
    data: {
      approvable_id: approvableItem.id,
      start_date: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      end_date: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      reason: `Test Reason ${1}`,
      user_id: testUser.id,
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
