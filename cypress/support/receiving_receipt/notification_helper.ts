import { prisma, ALL_ENTITIES } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

/**
 * Fixture for the receiving_receipt notification specs. Deliberately mirrors
 * the shape of the real gap this closes: a distinct requestor (creates the
 * receipt) and a distinct approver (holds the receiving_receipt_line
 * approval_flow's approver role) so Trigger #2's excludeUserId logic has a
 * real, non-empty recipient to exclude-around — not the single-Administrator
 * setup where creator and sole approver coincide.
 */
export async function setupReceivingReceiptNotificationFixture() {
  const { hashPassword } = require('../test-credentials');
  const testUser = await getTestUser();
  const hashedPw = await hashPassword('test-password');

  const approverRole = await prisma.role.create({
    data: { name: `Test RR Notification Approver Role ${Date.now()}`, creator_id: testUser.id, updater_id: testUser.id },
  });
  const requestorRole = await prisma.role.create({
    data: { name: `Test RR Notification Requestor Role ${Date.now()}`, creator_id: testUser.id, updater_id: testUser.id },
  });

  await Promise.all(
    [approverRole, requestorRole].flatMap(role =>
      ALL_ENTITIES.map(entity =>
        prisma.permission.create({
          data: {
            name: entity,
            role_id: role.id,
            create: true,
            read: true,
            update: true,
            delete: true,
            creator_id: testUser.id,
            updater_id: testUser.id,
          },
        })
      )
    )
  );

  const approverUser = await prisma.user.create({
    data: {
      name: 'Test RR Notification Approver',
      email: `test-rr-notification-approver-${Date.now()}@example.com`,
      password: hashedPw,
      api_key: `test_mk_rr_notification_approver_${Date.now()}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });

  const requestorUser = await prisma.user.create({
    data: {
      name: 'Test RR Notification Requestor',
      email: `test-rr-notification-requestor-${Date.now()}@example.com`,
      password: hashedPw,
      api_key: `test_mk_rr_notification_requestor_${Date.now()}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      roles: { connect: [{ id: requestorRole.id }] },
    },
  });

  const flow = await prisma.approval_flow.create({
    data: {
      entity_name: 'receiving_receipt_line',
      requestor_role_id: null,
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  const attachable = await prisma.attachable.create({ data: {} });
  const product = await prisma.product.create({
    data: {
      attachable_id: attachable.id,
      code: `RR-NOTIF-PROD-${Date.now()}`,
      name: 'RR Notification Test Product',
      price: 10,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  return JSON.parse(JSON.stringify({ approverRole, requestorRole, approverUser, requestorUser, flow, product }));
}
