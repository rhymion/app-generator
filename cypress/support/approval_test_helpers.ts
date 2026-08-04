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
 * cmd_541: seeds a two-stage `preceded_by` approval chain (flow2 preceded
 * by flow1) on a single approvable, with both flows' approval_request rows
 * created up front — the same shape service_after_create_stub.ts.jinja2
 * produces for a real entity (all flows' requests created together at
 * entity-creation time, before any of them are actionable except the
 * first). `entity_name: 'user'` is an arbitrary label (default-schema-safe,
 * same convention as subtask_539a's setupApprovalNotificationFixture) —
 * this fixture never touches a real `user`-entity approvable bridge.
 */
export async function setupMultiStageApprovalFixture() {
  const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed-tenant has run first.');

  const hashedPassword = await getTestPasswordHash();

  async function createApproverRoleAndUser(label: string) {
    const role = await prisma.role.create({
      data: {
        name: `Multi-Stage Approval ${label} Role ${createId()}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    const userId = createId();
    const email = `multi_stage_approval_${label.toLowerCase()}_${userId}@example.com`;
    await prisma.user.create({
      data: {
        id: userId,
        creator_id: testUser.id,
        updater_id: testUser.id,
        email,
        name: `Multi-Stage Approval ${label}`,
        password: hashedPassword,
        roles: { connect: [{ id: role.id }] },
      },
    });
    return { roleId: role.id, userId, email };
  }

  const approver1 = await createApproverRoleAndUser('Stage1');
  const approver2 = await createApproverRoleAndUser('Stage2');

  const flow1 = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: approver1.roleId,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });
  const flow2 = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: approver2.roleId,
      creator_id: testUser.id,
      updater_id: testUser.id,
      preceded_by: { connect: [{ id: flow1.id }] },
    },
  });

  const approvable = await prisma.approvable.create({ data: { creator_id: testUser.id } });
  const approvalRequest1 = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flow1.id, status: 'pending' },
  });
  const approvalRequest2 = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flow2.id, status: 'pending' },
  });

  // Mirror service_after_create_stub.ts.jinja2's for-loop: every flow's
  // approval_request gets its Trigger #2 creation notification up front,
  // regardless of whether that flow is actionable yet (§16.4/16.8 of
  // docs/knowledge/appendix/approval-flow.md) — so this fixture's baseline
  // matches a real multi-stage chain: flow2's approver already holds an
  // 'approval_requested' notification before flow1 is ever approved.
  // Written directly via `notification.create` (not by importing and
  // calling the real notifyApprovalRequestCreated()) because that function
  // pulls in lib/_notifier.ts -> lib/prisma.ts, which uses a top-level
  // `await` cy.task's esbuild (cjs output) transform can't compile.
  await prisma.notification.createMany({
    data: [
      {
        user_id: approver1.userId,
        type: 'approval_requested',
        payload: { title: 'New approval request: user', approvalRequestId: approvalRequest1.id, entityName: 'user' },
      },
      {
        user_id: approver2.userId,
        type: 'approval_requested',
        payload: { title: 'New approval request: user', approvalRequestId: approvalRequest2.id, entityName: 'user' },
      },
    ],
  });

  return JSON.parse(
    JSON.stringify({
      approvableId: approvable.id,
      flow1Id: flow1.id,
      flow2Id: flow2.id,
      approvalRequest1Id: approvalRequest1.id,
      approvalRequest2Id: approvalRequest2.id,
      approver1Email: approver1.email,
      approver2Email: approver2.email,
      approver2UserId: approver2.userId,
      requesterUserId: testUser.id,
    }),
  );
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
