'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';

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
