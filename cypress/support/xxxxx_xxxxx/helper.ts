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

export async function populateXxxxxXxxxxDependencies() {
  return {};
}

export async function populateXxxxxXxxxxData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.xxxxx_xxxxx.create({
      data: {
        name: `Xxxxx Xxxxx ${i}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateXxxxxXxxxxFullData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.xxxxx_xxxxx.create({
      data: {
        name: `Xxxxx Xxxxx ${i}`,
        description: `Test Description ${i}`,
        team: `Test Team ${i}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export async function populateXxxxxXxxxxYyyyyYyyyyData(parentId: string, length: number) {
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.yyyyy_yyyyy.create({
      data: {
        xxxxx_xxxxx_id: parentId,
        name: `Yyyyy Yyyyy ${i}`,
        type: 'string',
        max_length: Math.max(1, i * 100),
        max: i * 100,
        regex: `Test Regex ${i}`,
        required: i % 2 === 0,
        written_by: `Test Written By ${i}`,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

