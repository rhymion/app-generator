import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { notify } from '@/lib/_notifier';
import { revalidatePath } from 'next/cache';

// approval_history.pre_status/post_status are separate legacy Int columns
// (ordinal snapshot, out of Class A Batch A1 scope) — this maps the
// ApprovalRequestStatus enum back to its historical ordinal index.
const APPROVAL_REQUEST_STATUS_ORDER = ['Pending', 'Approved', 'Rejected', 'TerminalRejected'] as const;
function statusOrdinal(status: string): number {
  return APPROVAL_REQUEST_STATUS_ORDER.indexOf(status as (typeof APPROVAL_REQUEST_STATUS_ORDER)[number]);
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * lib/approval_request/{resolve_target,on_approved_dispatch,on_rejected_dispatch}.ts
 * are generator-emitted (code_generator/generate.py, PR #203) and do not
 * exist in a checkout before `npm run generate-code` has run. This module
 * takes them as injected collaborators instead of statically importing
 * them, so createApprovalActions() — and its unit test, actions.test.ts —
 * never depend on generated output being present. The real implementations
 * are wired in by lib/approval_request/actions.ts (the only place that
 * statically imports the generated modules). See
 * docs/knowledge/troubleshooting.md §2.4.
 */
export type ApprovalActionDeps = {
  resolveApprovableTarget: (
    tx: TransactionClient,
    entityName: string,
    approvableId: string,
  ) => Promise<{ id: string } | null>;
  dispatchOnApproved: (
    tx: TransactionClient,
    entityName: string,
    approvableId: string,
    userId: string,
  ) => Promise<void>;
  dispatchOnRejected: (
    tx: TransactionClient,
    entityName: string,
    approvableId: string,
    userId: string,
  ) => Promise<void>;
  isTerminalReject: (entityName: string) => boolean;
};

export function createApprovalActions(deps: ApprovalActionDeps) {
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
    if (req.status !== 'Rejected') throw new Error('Only rejected requests can be re-submitted');

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

  /**
   * Look up the user who created the entity behind an approval_request so the
   * approve/reject paths can notify them, plus that entity's own detail-page
   * link (cmd_479: was hard-coded to the approval_request's own — nonexistent
   * — view page; now resolved generically via deps.resolveApprovableTarget).
   * Returns null fields when the request has no approvable bridge yet
   * (legacy / mid-migration rows).
   */
  async function getApprovalRequestRecipient(id: string): Promise<{
    recipientId: string | null;
    entityName: string | null;
    href: string | undefined;
  }> {
    const row = await prisma.approval_request.findUnique({
      where: { id },
      select: {
        approvable_id: true,
        approval_flow: { select: { entity_name: true } },
        approvable: { select: { creator_id: true } },
      },
    });
    const entityName = row?.approval_flow?.entity_name ?? null;
    const target =
      entityName && row?.approvable_id
        ? await deps.resolveApprovableTarget(prisma, entityName, row.approvable_id)
        : null;
    return {
      recipientId: row?.approvable?.creator_id ?? null,
      entityName,
      href: target ? `/${entityName}/view/${target.id}` : undefined,
    };
  }

  async function approveApprovalRequest(id: string, message?: string): Promise<void> {
    await assertApproverRole(id);
    const userId = await getSessionUserIdOrThrow();
    await prisma.$transaction(async (tx) => {
      const req = await tx.approval_request.update({
        where: { id },
        data: { status: 'Approved' },
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
          post_status: statusOrdinal(req.status),
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
      const allApproved = approvableData?.approval_requests.every((r) => r.status === 'Approved') ?? false;
      const alreadyFired = approvableData?.approved_at != null;
      if (allApproved && !alreadyFired && approvableData) {
        // Set approved_at first (idempotency flag — prevents double-fire on concurrent requests)
        await tx.approvable.update({
          where: { id: approvableData.id },
          data: { approved_at: new Date() },
        });
        await deps.dispatchOnApproved(tx, req.approval_flow.entity_name, approvableData.id, userId);
      }
    });
    // Fire-and-forget notification (trigger #3): the requester learns the
    // outcome without sharing the approval_history transaction.
    const { recipientId, entityName, href } = await getApprovalRequestRecipient(id);
    if (recipientId && recipientId !== userId) {
      notify(recipientId, 'approval_responded', {
        title: `Your ${entityName ?? 'request'} was approved`,
        href,
        approvalRequestId: id,
        status: 'approved',
        message: message ?? null,
      });
    }
    revalidatePath('/approval_request');
  }

  async function rejectApprovalRequest(
    id: string,
    message?: string,
    options?: { reason?: string; reasonKind?: number },
  ): Promise<void> {
    await assertApproverRole(id);
    const userId = await getSessionUserIdOrThrow();
    await prisma.$transaction(async (tx) => {
      const req = await tx.approval_request.findUnique({
        where: { id },
        select: { approval_flow: { select: { entity_name: true } } },
      });
      if (!req?.approval_flow) throw new Error('Approval request not found');

      const terminal = deps.isTerminalReject(req.approval_flow.entity_name);
      const newStatus = terminal ? 'TerminalRejected' : 'Rejected';

      const result = await tx.approval_request.update({
        where: { id },
        data: { status: newStatus },
        select: { id: true, status: true, approvable_id: true },
      });
      await tx.approval_history.create({
        data: {
          approval_request_id: id,
          pre_status: 0,
          post_status: statusOrdinal(newStatus),
          message: message ?? null,
          creator_id: userId,
          reason_kind: options?.reasonKind ?? null,
        },
      });

      const approvableData = await tx.approvable.findUnique({
        where: { id: result.approvable_id },
        select: { id: true, approved_at: true },
      });

      if (options?.reason && approvableData) {
        await tx.approvable.update({
          where: { id: approvableData.id },
          data: { rejection_reason: options.reason },
        });
      }

      if (terminal) {
        const alreadyFired = approvableData?.approved_at != null;
        if (!alreadyFired && approvableData) {
          await tx.approvable.update({
            where: { id: approvableData.id },
            data: { approved_at: new Date() },
          });
          await deps.dispatchOnRejected(tx, req.approval_flow.entity_name, approvableData.id, userId);
        }
      } else if (approvableData) {
        await deps.dispatchOnRejected(tx, req.approval_flow.entity_name, approvableData.id, userId);
      }
    }, { isolationLevel: 'Serializable' });
    const { recipientId, entityName, href } = await getApprovalRequestRecipient(id);
    if (recipientId && recipientId !== userId) {
      notify(recipientId, 'approval_responded', {
        title: `Your ${entityName ?? 'request'} was rejected`,
        href,
        approvalRequestId: id,
        status: 'rejected',
        message: message ?? null,
      });
    }
    revalidatePath('/approval_request');
  }

  async function resubmitApprovalRequest(id: string, message?: string): Promise<void> {
    await assertResubmitPermission(id);
    const userId = await getSessionUserIdOrThrow();
    await prisma.$transaction(async (tx) => {
      const prev = await tx.approval_request.findUnique({
        where: { id },
        select: { status: true },
      });
      await tx.approval_request.update({
        where: { id },
        data: { status: 'Pending' },
      });
      await tx.approval_history.create({
        data: {
          approval_request_id: id,
          pre_status: prev ? statusOrdinal(prev.status) : 2,
          post_status: 0,
          message: message ?? null,
          creator_id: userId,
        },
      });
    });
    revalidatePath('/approval_request');
  }

  return {
    getApprovalRequestRecipient,
    approveApprovalRequest,
    rejectApprovalRequest,
    resubmitApprovalRequest,
  };
}
