import { prisma } from './db-helpers';
import { TEST_CREDENTIALS, getTestPasswordHash } from './test-credentials';
import { createId } from '@paralleldrive/cuid2';

/**
 * Generic approval/ledger read helpers shared by B-5 Phase2c D7 tests
 * (purchase_per_item reservation cancel + receiving_receipt_line terminal
 * reject no-op). Kept entity-agnostic so both domains reuse the same tasks.
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
