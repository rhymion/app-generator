import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getUserRoleIds } from '@/lib/authz';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';
import { isTerminalReject, dispatchOnRejected } from '@/lib/approval_request/on_rejected_dispatch';
import { getApprovalRequestRecipient } from '@/lib/approval_request/actions';
import { notify } from '@/lib/_notifier';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // cmd_648: dual-auth — X-API-Key/Authorization header when present,
    // session cookie otherwise (see app/api/search/route.ts).
    const { userId } = await requireDualAuth(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      select: { approval_flow: { select: { approver_role_id: true, entity_name: true } } },
    });
    if (!req?.approval_flow) throw new ApiError(404, 'Approval request not found');

    const roleIds = await getUserRoleIds(userId);
    if (!roleIds.includes(req.approval_flow.approver_role_id)) {
      throw new ApiError(403, 'Access denied: not a member of the approver role');
    }

    await assertApprovalOrder(id);

    const terminal = isTerminalReject(req.approval_flow.entity_name);
    const newStatus = terminal ? 'terminal_rejected' : 'rejected';
    // approval_history.post_status is a separate legacy Int snapshot column (out of scope).
    const newStatusOrdinal = terminal ? 3 : 2;

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;
    const reason: string | undefined = body?.reason || undefined;
    const reasonKind: number | undefined =
      (typeof body?.reason_kind === 'number') ? body.reason_kind : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.approval_request.update({
        where: { id },
        data: { status: newStatus },
        select: {
          id: true,
          status: true,
          approvable_id: true,
          approval_flow: { select: { entity_name: true } },
        },
      });
      await tx.approval_history.create({
        data: { approval_request_id: id, pre_status: 0, post_status: newStatusOrdinal, message: message ?? null, creator_id: userId, reason_kind: reasonKind ?? null },
      });

      // on_rejected dispatch
      const approvableData = await tx.approvable.findUnique({
        where: { id: result.approvable_id },
        select: { id: true, approved_at: true },
      });

      if (reason && approvableData) {
        await tx.approvable.update({
          where: { id: approvableData.id },
          data: { rejection_reason: reason },
        });
      }

      if (terminal) {
        // Symmetric to the O-5 guard on approve: idempotency via approved_at
        const alreadyFired = approvableData?.approved_at != null;
        if (!alreadyFired && approvableData) {
          await tx.approvable.update({
            where: { id: approvableData.id },
            data: { approved_at: new Date() },
          });
          await dispatchOnRejected(tx, result.approval_flow.entity_name, approvableData.id, userId);
        }
      } else {
        // Non-terminal: dispatch every time (set_fields side effect)
        if (approvableData) {
          await dispatchOnRejected(tx, result.approval_flow.entity_name, approvableData.id, userId);
        }
      }
      return result;
    }, { isolationLevel: 'Serializable' });
    // cmd_479: mirrors lib/approval_request/actions.ts's rejectApprovalRequest()
    // post-transaction notify block — see the approve route's comment for why
    // this REST path needs its own copy of it.
    const { recipientId, entityName, href } = await getApprovalRequestRecipient(id);
    if (recipientId && recipientId !== userId) {
      notify(recipientId, 'approval_responded', {
        title: `Your ${entityName ?? 'request'} was rejected`,
        href,
        approvalRequestId: id,
        // cmd_539: was hard-coded to 'rejected' even for a terminal
        // rejection — the notification fired either way, but its payload
        // misreported the actual outcome.
        status: newStatus,
        message: message ?? null,
      });
    }
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
