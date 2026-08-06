// Handwritten test helper — not auto-generated. `audit_log` is not declared
// as an entity in json_schema.yaml, so no generator template renders this
// file (confirmed cmd_554, re-confirmed cmd_566).
//
// Pitfall #1: if audit_log is ever added to json_schema.yaml with
// x-generate.test: true, generate.py's _write() (code_generator/generate.py)
// overwrites unconditionally — no exists() check — and will silently
// replace this file with generated content. No conflict error is raised;
// the only signal would be a diff after the next generate-code run.
//
// Pitfall #2: this header deliberately avoids the sentinel comment that
// marks genuinely generated files elsewhere in this repo (see e.g. the
// first line of lib/db-init.ts). cleanup.py's orphan sweep
// (_delete_if_generated, applied to every cypress/support/<dir>/*.ts whose
// <dir> has no matching schema entity) deletes any file carrying that
// sentinel outright. Since audit_log matches no schema entity, carrying
// that sentinel here would make a plain `npm run cleanup` — no schema
// change required — delete this file today.
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
