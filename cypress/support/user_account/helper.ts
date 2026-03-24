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

export async function populateUserAccountDependencies() {
  const testUser = await getTestUser();
  const roles = await prisma.role.create({
    data: {
      name: 'Test Roles',
      creator_id: testUser.id,
      updater_id: testUser.id,
      user_accounts: {
        connect: [testUser.id].map((id) => ({ id })),
      },
    },
  });
  return { roles };
}

export async function populateUserAccountData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.user_account.create({
      data: {
        name: `User Account ${i}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populateUserAccountFullData = populateUserAccountData;
