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

async function _createApprovalFlowBaseDeps() {
  const testUser = await getTestUser();
  // Idempotent: re-use an existing row when the helper is called more than
  // once in a single test (e.g. parent populator + child populator).
  let requestorRoleRecord = await prisma.role.findFirst({
    where: { name: 'Test Requestor Role' },
    orderBy: { created_at: 'asc' },
  });
  if (!requestorRoleRecord) {
    requestorRoleRecord = await prisma.role.create({
      data: {
        name: 'Test Requestor Role',
        creator_id: testUser.id,
        updater_id: testUser.id,
        users: {
          connect: [testUser.id].map((id) => ({ id })),
        },
      },
    });
  }
  const requestorRole = requestorRoleRecord;
  // Idempotent: re-use an existing row when the helper is called more than
  // once in a single test (e.g. parent populator + child populator).
  let approverRoleRecord = await prisma.role.findFirst({
    where: { name: 'Test Approver Role' },
    orderBy: { created_at: 'asc' },
  });
  if (!approverRoleRecord) {
    approverRoleRecord = await prisma.role.create({
      data: {
        name: 'Test Approver Role',
        creator_id: testUser.id,
        updater_id: testUser.id,
        users: {
          connect: [testUser.id].map((id) => ({ id })),
        },
      },
    });
  }
  const approverRole = approverRoleRecord;
  return JSON.parse(JSON.stringify({ requestorRole, approverRole, role: approverRole }));
}

export async function populateApprovalFlowDependencies() {
  const baseDeps = await _createApprovalFlowBaseDeps();
  const testUser = await getTestUser();
  const precededByRecord = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: baseDeps.approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const precededBy = { ...precededByRecord, name: (precededByRecord.entity_name ?? '') };
  const followedByRecord = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: baseDeps.approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const followedBy = { ...followedByRecord, name: (followedByRecord.entity_name ?? '') };
  return JSON.parse(JSON.stringify({ ...baseDeps, precededBy, followedBy }));
}

export async function populateApprovalFlowData(length: number) {
  const testUser = await getTestUser();
  const deps = await _createApprovalFlowBaseDeps();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.approval_flow.create({
      data: {
        entity_name: 'user',
        approver_role_id: deps.approverRole.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateApprovalFlowFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateApprovalFlowDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.approval_flow.create({
      data: {
        entity_name: 'user',
        requestor_role_id: deps.requestorRole.id,
        approver_role_id: deps.approverRole.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
