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
  // Idempotent: re-use an existing row (created by an earlier helper call in
  // the same test) instead of creating a duplicate that would trip @unique.
  let roomTypeRecord = await prisma.room_type.findFirst({
    where: { name: 'Test Room Type' },
    orderBy: { created_at: 'asc' },
  });
  if (!roomTypeRecord) {
    roomTypeRecord = await prisma.room_type.create({
      data: {
        name: 'Test Room Type',
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
  }
  const roomType = roomTypeRecord;
  const roomNoteable = await prisma.noteable.create({ data: {} });
  const roomRecord = await prisma.room.create({
    data: {
      noteable_id: roomNoteable.id,
      room_no: 'Test Room No',
      status: 0,
      room_type_id: roomType.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const room = roomRecord;
  return { organization, roomType, room };
}

export async function populateNoteData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateNoteDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const noteableItem = await prisma.noteable.create({ data: {} });
    const record = await prisma.note.create({
      data: {
        noteable_id: noteableItem.id,
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
    const noteableItem = await prisma.noteable.create({ data: {} });
    const record = await prisma.note.create({
      data: {
        noteable_id: noteableItem.id,
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
