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

export async function populateCharacterDependencies() {
  const testUser = await getTestUser();
  const workChannelable = await prisma.channelable.create({ data: {} });
  const workFcLinkable = await prisma.fc_linkable.create({ data: {} });
  const workRecord = await prisma.work.create({
    data: {
      channelable_id: workChannelable.id,
      fc_linkable_id: workFcLinkable.id,
      title: 'Test Title',
      pattern: 0,
      status: 0,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const work = { ...workRecord, name: (workRecord.title ?? '') };
  return { work };
}

export async function populateCharacterData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateCharacterDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const channelableItem = await prisma.channelable.create({ data: {} });
    const fcLinkableItem = await prisma.fc_linkable.create({ data: {} });
    const record = await prisma.character.create({
      data: {
        channelable_id: channelableItem.id,
        fc_linkable_id: fcLinkableItem.id,
        name: `Character ${i}`,
        work_id: deps.work.id,
        official_image: i % 2 === 0,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populateCharacterFullData = populateCharacterData;
