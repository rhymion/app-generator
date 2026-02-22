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

export async function populateBookingDependencies() {
  const testUser = await getTestUser();
  const organization = await prisma.organization.create({
    data: { name: 'Test Organization', creator_id: testUser.id, updater_id: testUser.id, 
      user_accounts: {
        connect: [testUser.id].map((id) => ({ id }))
      } 
    },
  });
  const resource = await prisma.resource.create({
    data: { name: 'Test Resource', organization_id: organization.id, creator_id: testUser.id, updater_id: testUser.id },
  });
  return { organization, resource };
}

export async function populateBookingData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateBookingDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.booking.create({
      data: {
        name: `Booking ${i}`,
        resource_id: deps.resource.id,
        start_time: new Date(2025, 0, i, 9, 0).toISOString(),
        end_time: new Date(2025, 0, i, 17, 0).toISOString(),
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  return records;
}

export const populateBookingFullData = populateBookingData;

