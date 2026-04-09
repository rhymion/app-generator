'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';

async function assertApproverRole(id: string): Promise<string | undefined> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: { approval_flow: { select: { approver_role_id: true, entity_name: true } } },
  });
  if (!req?.approval_flow) throw new Error('Approval request not found');
  const userId = await getSessionUserIdOrThrow();
  const roleIds = await getUserRoleIds(userId);
  if (!roleIds.includes(req.approval_flow.approver_role_id)) {
    throw new Error('Access denied: not a member of the approver role');
  }
  return req.approval_flow.entity_name;
}

async function assertApprovalOrder(id: string): Promise<void> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: {
      approvable_id: true,
      approval_flow: { select: { preceded_by: { select: { id: true } } } },
    },
  });
  if (!req) throw new Error('Approval request not found');
  const precedingFlowIds = req.approval_flow?.preceded_by.map((f) => f.id) ?? [];
  if (precedingFlowIds.length === 0) return;
  const siblings = await prisma.approval_request.findMany({
    where: { approvable_id: req.approvable_id, approval_flow_id: { in: precedingFlowIds } },
    select: { approval_flow_id: true, status: true },
  });
  const allApproved = precedingFlowIds.every((fid) =>
    siblings.some((s) => s.approval_flow_id === fid && s.status === 1),
  );
  if (!allApproved) {
    throw new Error('Preceding approval requests must be approved first');
  }
}

async function assertResubmitPermission(id: string): Promise<string | undefined> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: {
      status: true,
      approval_flow: { select: { requestor_role_id: true, entity_name: true } },
      approvable: { select: { creator_id: true } },
    },
  });
  if (!req) throw new Error('Approval request not found');
  if (req.status !== 2) throw new Error('Only rejected requests can be re-submitted');

  const userId = await getSessionUserIdOrThrow();
  const entityCreatorId = req.approvable?.creator_id;
  if (entityCreatorId === userId) return req.approval_flow?.entity_name;

  const requestorRoleId = req.approval_flow?.requestor_role_id;
  if (requestorRoleId) {
    const roleIds = await getUserRoleIds(userId);
    if (roleIds.includes(requestorRoleId)) return req.approval_flow?.entity_name;
  }

  throw new Error('Access denied: not authorized to re-submit this request');
}

export async function approveApprovalRequest(id: string, message?: string): Promise<void> {
  const entityName = await assertApproverRole(id);
  await assertApprovalOrder(id);
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
  if (entityName) revalidatePath('/' + entityName);
}

export async function rejectApprovalRequest(id: string, message?: string): Promise<void> {
  const entityName = await assertApproverRole(id);
  await assertApprovalOrder(id);
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
  if (entityName) revalidatePath('/' + entityName);
}

export async function resubmitApprovalRequest(id: string, message?: string): Promise<void> {
  const entityName = await assertResubmitPermission(id);
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
  if (entityName) revalidatePath('/' + entityName);
}
