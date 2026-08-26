import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // cmd_648: dual-auth — X-API-Key/Authorization header when present,
    // session cookie otherwise (see app/api/search/route.ts).
    const { userId } = await requireDualAuth(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      select: { status: true, approvable: { select: { creator_id: true } } },
    });
    if (!req) throw new ApiError(404, 'Approval request not found');

    // cmd_825: withdrawal is the requestor's own action, not an approver
    // action — permission is "you are the person this request was
    // submitted for" (approvable.creator_id, the same field
    // getApprovalRequestRecipient already treats as the requestor), not
    // approval_flow.approver_role_id membership.
    if (!req.approvable || req.approvable.creator_id !== userId) {
      throw new ApiError(403, 'Access denied: only the requestor may withdraw their own request');
    }
    if (req.status !== 'pending') {
      throw new ApiError(400, 'Only a pending approval request can be withdrawn');
    }

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.approval_request.update({
        where: { id },
        data: { status: 'withdrawn' },
        select: { id: true, status: true, approvable_id: true },
      });
      // approval_history.pre_status/post_status are the same legacy Int
      // snapshot columns approve/reject stamp -- 'withdrawn' is appended
      // to actions_core.ts's APPROVAL_REQUEST_STATUS_ORDER at index 4.
      await tx.approval_history.create({
        data: { approval_request_id: id, pre_status: 0, post_status: 4, message: message ?? null, creator_id: userId },
      });
      return result;
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
