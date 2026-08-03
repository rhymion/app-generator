import { prisma } from './db-helpers';
import { TEST_CREDENTIALS, getTestPasswordHash } from './test-credentials';
import { createId } from '@paralleldrive/cuid2';

/**
 * Generic, entity-agnostic approval_request read/fixture helpers, kept
 * default-schema-safe (no dependency on a non-default consumer entity —
 * see commit 5840faf8, which removed the previous receiving_receipt/
 * leave_request-coupled versions of this file for exactly that reason).
 */

export async function getApprovableById(approvable_id: string) {
  const approvable = await prisma.approvable.findUnique({ where: { id: approvable_id } });
  return approvable ? JSON.parse(JSON.stringify(approvable)) : null;
}

export async function getPendingApprovalRequest(approvable_id: string) {
  const ar = await prisma.approval_request.findFirst({
    where: { approvable_id, status: 'pending' },
  });
  return ar ? JSON.parse(JSON.stringify(ar)) : null;
}

/**
 * cmd_539: fixture for approval_request notification regression tests —
 * one approval_flow + approvable + pending approval_request, plus a real
 * loginable approver-role user (shared TEST_CREDENTIALS password so
 * cy.login() works). `entity_name` is an arbitrary label ('user'); no
 * schema entity actually needs to declare an approvable bridge for the
 * notification code paths under test (they only read the approval_flow
 * row + approver role membership at runtime) — this keeps the fixture
 * default-schema-safe per the same constraint as the rest of this file.
 * The seeded TEST_CREDENTIALS user plays the requester/creator role — it
 * already carries TEST_API_KEY (see db:seed), needed to call the
 * API-key-authenticated resubmit route.
 */
export async function setupApprovalNotificationFixture() {
  const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');

  const hashedPassword = await getTestPasswordHash();
  const approverRole = await prisma.role.create({
    data: {
      name: `Approval Notif Approver Role ${createId()}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const approverUserId = createId();
  const approverEmail = `approval_notif_approver_${approverUserId}@example.com`;
  await prisma.user.create({
    data: {
      id: approverUserId,
      creator_id: testUser.id,
      updater_id: testUser.id,
      email: approverEmail,
      name: 'Approval Notif Approver',
      password: hashedPassword,
      roles: { connect: [{ id: approverRole.id }] },
    },
  });
  const approvalFlow = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: approverRole.id,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const approvable = await prisma.approvable.create({ data: { creator_id: testUser.id } });
  const approvalRequest = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: approvalFlow.id, status: 'pending' },
  });

  return JSON.parse(
    JSON.stringify({
      approvalRequestId: approvalRequest.id,
      approvableId: approvable.id,
      approverEmail,
      approverUserId,
      requesterUserId: testUser.id,
    }),
  );
}
