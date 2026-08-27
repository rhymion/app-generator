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
      select: { approvable_id: true, approvable: { select: { creator_id: true } } },
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

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;

    // cmd_844: withdrawal is round-scoped, not single-row -- this route's
    // URL still keys by a specific approval_request `id` (external API
    // contract, see subtask_843a's investigation into purchase_per_item),
    // but internally that id is only used to resolve the approvable + its
    // current round; every still-pending row of that round is closed,
    // mirroring lib/approval_request/actions_core.ts's
    // withdrawApprovalRequest(). Approved rows are never rewritten (PD-1's
    // final ruling: round_id scoping alone).
    const updated = await prisma.$transaction(async (tx) => {
      const latestRoundRow = await tx.approval_request.findFirst({
        where: { approvable_id: req.approvable_id },
        orderBy: { created_at: 'desc' },
        select: { round_id: true },
      });
      if (!latestRoundRow) throw new ApiError(404, 'No approval request found');

      const pendingRows = await tx.approval_request.findMany({
        where: { approvable_id: req.approvable_id, round_id: latestRoundRow.round_id, status: 'pending' },
        select: { id: true },
      });
      if (pendingRows.length === 0) {
        throw new ApiError(400, 'No pending requests to withdraw');
      }

      await tx.approval_request.updateMany({
        where: { id: { in: pendingRows.map((r) => r.id) } },
        data: { status: 'withdrawn' },
      });
      // approval_history.pre_status/post_status are the same legacy Int
      // snapshot columns approve/reject stamp -- 'withdrawn' is appended to
      // actions_core.ts's APPROVAL_REQUEST_STATUS_ORDER at index 4.
      // pre_status is 0 ('pending') for every row here -- guaranteed by the
      // status: 'pending' filter above, not a stale hardcode.
      await tx.approval_history.createMany({
        data: pendingRows.map((r) => ({
          approval_request_id: r.id,
          pre_status: 0,
          post_status: 4,
          message: message ?? null,
          creator_id: userId,
        })),
      });
      // cmd_844: `status: 'withdrawn'` is kept in the response for the
      // existing API contract (test_api_spec.cy.ts.jinja2's 14.4 scenario
      // asserts on it) even though this is now a round-level operation, not
      // a single row -- every row this call closes did transition to
      // 'withdrawn'. `withdrawnIds` is additive, not a breaking change.
      return { id, status: 'withdrawn', approvable_id: req.approvable_id, withdrawnIds: pendingRows.map((r) => r.id) };
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
