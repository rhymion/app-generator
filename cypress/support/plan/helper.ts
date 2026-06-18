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

export async function populatePlanDependencies() {
  return {};
}

export async function populatePlanData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.plan.create({
      data: {
        tier: 0,
        reaction_kinds_allowed: Math.max(0, i * 100),
        sub_account_limit: Math.max(0, i * 100),
        can_view_paid_posts: i % 2 === 0,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populatePlanFullData = populatePlanData;
