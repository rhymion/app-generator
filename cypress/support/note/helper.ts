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

export async function populateNoteDependencies() {
  const testUser = await getTestUser();
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let organizationRecord = await prisma.organization.findFirst({
    where: { name: 'Test Organization' },
    orderBy: { created_at: 'asc' },
  });
  if (!organizationRecord) {
    organizationRecord = await prisma.organization.create({
      data: {
        name: 'Test Organization',
        creator_id: testUser.id,
        updater_id: testUser.id,
        users: {
          connect: [testUser.id].map((id) => ({ id })),
        },
      },
    });
  }
  const organization = organizationRecord;
  return { organization };
}

export async function populateNoteData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateNoteDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.note.create({
      data: {
        title: `Test Title ${i}`,
        organization_id: deps.organization.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateNoteFullData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateNoteDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.note.create({
      data: {
        title: `Test Title ${i}`,
        description: `Test Description ${i}`,
        organization_id: deps.organization.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
