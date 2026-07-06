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

export async function populateAuditLogDependencies() {
  const testUser = await getTestUser();
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let actionUserRecord = await prisma.user.findFirst({
    where: { name: 'Test Action User' },
    orderBy: { created_at: 'asc' },
  });
  if (!actionUserRecord) {
    actionUserRecord = await prisma.user.create({
      data: {
        name: 'Test Action User',
        email: `test-actionUser-${Date.now()}@example.com`,
        password: 'test-password',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  const actionUser = actionUserRecord;
  return { actionUser };
}

export async function populateAuditLogData(length: number) {
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.audit_log.create({
      data: {
        action: `Test Action ${i}`,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateAuditLogFullData(length: number) {
  const deps = await populateAuditLogDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.audit_log.create({
      data: {
        target_table: `Test Target Table ${i}`,
        target_id: `Test Target Id ${i}`,
        action: `Test Action ${i}`,
        actor_user_id: deps.actionUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
