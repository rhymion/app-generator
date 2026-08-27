import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getUserRoleIds } from '@/lib/authz';
import { assertApprovalOrder, findNewlyActionableFollowFlowIds } from '@/lib/approval_request/order-check';
import { dispatchOnApproved } from '@/lib/approval_request/on_approved_dispatch';
import { getApprovalRequestRecipient } from '@/lib/approval_request/actions';
import { notify } from '@/lib/_notifier';
import { notifyApprovalOrderReached } from '@/lib/_notifyApprovalRequest';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // cmd_648: dual-auth — X-API-Key/Authorization header when present,
    // session cookie otherwise (see app/api/search/route.ts).
    const { userId } = await requireDualAuth(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      select: { approval_flow: { select: { approver_role_id: true } } },
    });
    if (!req?.approval_flow) throw new ApiError(404, 'Approval request not found');

    const roleIds = await getUserRoleIds(userId);
    if (!roleIds.includes(req.approval_flow.approver_role_id)) {
      throw new ApiError(403, 'Access denied: not a member of the approver role');
    }

    await assertApprovalOrder(id);

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;

    let orderReachedFlowIds: string[] = [];
    let orderReachedApprovableId: string | undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.approval_request.findUnique({
        where: { id },
        select: { status: true, approval_flow_id: true, round_id: true },
      });
      const result = await tx.approval_request.update({
        where: { id },
        data: { status: 'approved' },
        select: {
          id: true,
          status: true,
          approvable_id: true,
          round_id: true,
          approval_flow: { select: { entity_name: true } },
        },
      });
      await tx.approval_history.create({
        data: { approval_request_id: id, pre_status: 0, post_status: 1, message: message ?? null, creator_id: userId },
      });
      // Fire-once post-approval dispatch: runs only when every row of the
      // CURRENT ROUND is approved (cmd_844: round_id-scoped, mirroring
      // lib/approval_request/actions_core.ts's approveApprovalRequest() —
      // an unscoped approvable.approval_requests include would let a stale
      // row from a different round leak into this decision once
      // resubmission makes more than one round exist for the approvable).
      const currentRoundRequests = await tx.approval_request.findMany({
        where: { approvable_id: result.approvable_id, round_id: result.round_id },
        select: { status: true },
      });
      const approvableData = await tx.approvable.findUnique({
        where: { id: result.approvable_id },
        select: { id: true, approved_at: true },
      });
      const allApproved = currentRoundRequests.every((r) => r.status === 'approved');
      const alreadyFired = approvableData?.approved_at != null;
      if (allApproved && !alreadyFired && approvableData) {
        await tx.approvable.update({ where: { id: approvableData.id }, data: { approved_at: new Date() } });
        await dispatchOnApproved(tx, result.approval_flow.entity_name, approvableData.id, userId);
      }
      // cmd_541: notify approvers of any follow-on preceded_by flow that
      // just became actionable — see the parity note in
      // lib/approval_request/actions_core.ts's approveApprovalRequest() for
      // why `before.status !== 'approved'` guards against re-notifying on a
      // repeated approve call.
      if (before && before.status !== 'approved') {
        orderReachedFlowIds = await findNewlyActionableFollowFlowIds(tx, result.approvable_id, before.approval_flow_id, before.round_id);
        orderReachedApprovableId = result.approvable_id;
      }
      return result;
    }, { isolationLevel: 'Serializable' });
    // cmd_479: this REST route duplicates lib/approval_request/actions.ts's
    // approveApprovalRequest() transaction but, until now, never sent the
    // Trigger #3 notification that function sends after its own transaction
    // — so approving via the API (as opposed to the UI's ApprovalSection.tsx,
    // which calls the server action) silently never notified the requestor.
    // Mirrors that function's post-transaction notify block exactly.
    const { recipientId, entityName, targetId, href } = await getApprovalRequestRecipient(id);
    if (recipientId && recipientId !== userId) {
      notify(recipientId, 'approval_responded', {
        title: `Your ${entityName ?? 'request'} was approved`,
        href,
        approvalRequestId: id,
        status: 'approved',
        message: message ?? null,
      });
    }
    // cmd_541 (trigger #4): mirrors actions_core.ts's approveApprovalRequest() — see cmd_479 note above on why both implementations must be kept in parity.
    if (orderReachedApprovableId && orderReachedFlowIds.length > 0) {
      await notifyApprovalOrderReached(prisma, orderReachedApprovableId, orderReachedFlowIds, {
        excludeUserId: userId,
        targetEntityName: entityName,
        targetId,
      });
    }
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
