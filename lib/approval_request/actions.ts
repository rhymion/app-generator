'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { notify } from '@/lib/_notifier';
import { dispatchOnApproved } from '@/lib/approval_request/on_approved_dispatch';

/**
 * Look up the user who created the entity behind an approval_request so the
 * approve/reject paths can notify them. Returns null when the request has no
 * approvable bridge yet (legacy / mid-migration rows).
 */
async function getApprovalRequestRecipient(id: string): Promise<{
  recipientId: string | null;
  entityName: string | null;
}> {
  const row = await prisma.approval_request.findUnique({
    where: { id },
    select: {
      approval_flow: { select: { entity_name: true } },
      approvable: { select: { creator_id: true } },
    },
  });
  return {
    recipientId: row?.approvable?.creator_id ?? null,
    entityName: row?.approval_flow?.entity_name ?? null,
  };
}

async function assertApproverRole(id: string): Promise<void> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: { approval_flow: { select: { approver_role_id: true } } },
  });
  if (!req?.approval_flow) throw new Error('Approval request not found');
  const userId = await getSessionUserIdOrThrow();
  const roleIds = await getUserRoleIds(userId);
  if (!roleIds.includes(req.approval_flow.approver_role_id)) {
    throw new Error('Access denied: not a member of the approver role');
  }
}

async function assertResubmitPermission(id: string): Promise<void> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: {
      status: true,
      approval_flow: { select: { requestor_role_id: true } },
      approvable: { select: { creator_id: true } },
    },
  });
  if (!req) throw new Error('Approval request not found');
  if (req.status !== 2) throw new Error('Only rejected requests can be re-submitted');

  const userId = await getSessionUserIdOrThrow();
  const entityCreatorId = req.approvable?.creator_id;
  if (entityCreatorId === userId) return;

  const requestorRoleId = req.approval_flow?.requestor_role_id;
  if (requestorRoleId) {
    const roleIds = await getUserRoleIds(userId);
    if (roleIds.includes(requestorRoleId)) return;
  }

  throw new Error('Access denied: not authorized to re-submit this request');
}

export async function approveApprovalRequest(id: string, message?: string): Promise<void> {
  await assertApproverRole(id);
  const userId = await getSessionUserIdOrThrow();
  await prisma.$transaction(async (tx) => {
    const req = await tx.approval_request.update({
      where: { id },
      data: { status: 1 },
      select: {
        status: true,
        approvable_id: true,
        approval_flow: { select: { entity_name: true } },
      },
    });
    await tx.approval_history.create({
      data: {
        approval_request_id: id,
        pre_status: 0,
        post_status: req.status,
        message: message ?? null,
        creator_id: userId,
      },
    });
    // Fire-once: check if all approval_requests for this approvable are now approved
    const approvableData = await tx.approvable.findUnique({
      where: { id: req.approvable_id },
      select: {
        id: true,
        approved_at: true,
        approval_requests: { select: { status: true } },
      },
    });
    const allApproved = approvableData?.approval_requests.every((r) => r.status === 1) ?? false;
    const alreadyFired = approvableData?.approved_at != null;
    if (allApproved && !alreadyFired && approvableData) {
      // Set approved_at first (idempotency flag — prevents double-fire on concurrent requests)
      await tx.approvable.update({
        where: { id: approvableData.id },
        data: { approved_at: new Date() },
      });
      await dispatchOnApproved(tx, req.approval_flow.entity_name, approvableData.id, userId);
    }
  });
  // Fire-and-forget notification (trigger #3): the requester learns the
  // outcome without sharing the approval_history transaction.
  const { recipientId, entityName } = await getApprovalRequestRecipient(id);
  if (recipientId && recipientId !== userId) {
    notify(recipientId, 'approval_responded', {
      title: `Your ${entityName ?? 'request'} was approved`,
      href: `/approval_request/view/${id}`,
      approvalRequestId: id,
      status: 'approved',
      message: message ?? null,
    });
  }
  revalidatePath('/approval_request');
}

export async function rejectApprovalRequest(id: string, message?: string): Promise<void> {
  await assertApproverRole(id);
  const userId = await getSessionUserIdOrThrow();
  await prisma.$transaction(async (tx) => {
    const req = await tx.approval_request.update({
      where: { id },
      data: { status: 2 },
      select: { status: true },
    });
    await tx.approval_history.create({
      data: {
        approval_request_id: id,
        pre_status: 0,
        post_status: req.status,
        message: message ?? null,
        creator_id: userId,
      },
    });
  });
  const { recipientId, entityName } = await getApprovalRequestRecipient(id);
  if (recipientId && recipientId !== userId) {
    notify(recipientId, 'approval_responded', {
      title: `Your ${entityName ?? 'request'} was rejected`,
      href: `/approval_request/view/${id}`,
      approvalRequestId: id,
      status: 'rejected',
      message: message ?? null,
    });
  }
  revalidatePath('/approval_request');
}

export async function resubmitApprovalRequest(id: string, message?: string): Promise<void> {
  await assertResubmitPermission(id);
  const userId = await getSessionUserIdOrThrow();
  await prisma.$transaction(async (tx) => {
    const prev = await tx.approval_request.findUnique({
      where: { id },
      select: { status: true },
    });
    await tx.approval_request.update({
      where: { id },
      data: { status: 0 },
    });
    await tx.approval_history.create({
      data: {
        approval_request_id: id,
        pre_status: prev?.status ?? 2,
        post_status: 0,
        message: message ?? null,
        creator_id: userId,
      },
    });
  });
  revalidatePath('/approval_request');
}
