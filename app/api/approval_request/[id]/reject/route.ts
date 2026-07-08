import { NextRequest, NextResponse } from 'next/server';
import { requireSession, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getUserRoleIds } from '@/lib/authz';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';
import { isTerminalReject, dispatchOnRejected } from '@/lib/approval_request/on_rejected_dispatch';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireSession();

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
    const newStatus = terminal ? 3 : 2;

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;
    const reason: string | undefined = body?.reason || undefined;

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
        data: { approval_request_id: id, pre_status: 0, post_status: newStatus, message: message ?? null, creator_id: userId },
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
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
