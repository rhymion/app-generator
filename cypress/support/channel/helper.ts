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

export async function populateChannelDependencies() {
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
  const work = workRecord;
  return { organization, work };
}

export async function populateChannelData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateChannelDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const commentableItem = await prisma.commentable.create({ data: {} });
    const channelableItem = await prisma.channelable.create({ data: {} });
    const fcLinkableItem = await prisma.fc_linkable.create({ data: {} });
    const record = await prisma.channel.create({
      data: {
        commentable_id: commentableItem.id,
        channelable_id: channelableItem.id,
        fc_linkable_id: fcLinkableItem.id,
        name: `Channel ${i}`,
        kind: 0,
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

export const populateChannelFullData = populateChannelData;
