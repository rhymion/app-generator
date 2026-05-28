// AUTO-GENERATED - DO NOT EDIT
import { prisma } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populatePermissionDependencies() {
  const testUser = await getTestUser();
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let roleRecord = await prisma.role.findFirst({
    where: { name: 'Test Role' },
    orderBy: { created_at: 'asc' },
  });
  if (!roleRecord) {
    roleRecord = await prisma.role.create({
      data: {
        name: 'Test Role',
        creator_id: testUser.id,
        updater_id: testUser.id,
        users: {
          connect: [testUser.id].map((id) => ({ id })),
        },
      },
    });
  }
  const role = roleRecord;
  return { role };
}

export async function populatePermissionData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.permission.create({
      data: {
        name: 'user',
        create: i % 2 === 0,
        read: i % 2 === 0,
        update: i % 2 === 0,
        delete: i % 2 === 0,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populatePermissionFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populatePermissionDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.permission.create({
      data: {
        name: 'user',
        create: i % 2 === 0,
        read: i % 2 === 0,
        update: i % 2 === 0,
        delete: i % 2 === 0,
        role_id: deps.role.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
