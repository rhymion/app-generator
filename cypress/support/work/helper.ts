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

export async function populateWorkDependencies() {
  return {};
}

export async function populateWorkData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const channelableItem = await prisma.channelable.create({ data: {} });
    const fcLinkableItem = await prisma.fc_linkable.create({ data: {} });
    const record = await prisma.work.create({
      data: {
        channelable_id: channelableItem.id,
        fc_linkable_id: fcLinkableItem.id,
        title: `Test Title ${i}`,
        pattern: 0,
        status: 0,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populateWorkFullData = populateWorkData;
