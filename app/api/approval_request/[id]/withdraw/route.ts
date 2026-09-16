import { NextRequest, NextResponse } from 'next/server';
import { requireDualAuth, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { dispatchOnWithdrawn, ENTITIES_WITH_ON_WITHDRAWN } from '@/lib/approval_request/on_withdrawn_dispatch';
import { dispatchBeforeWithdraw } from '@/lib/approval_request/on_before_withdraw_dispatch';
import { resolveApprovableModel } from '@/lib/approval_request/resolve_target';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // cmd_648: dual-auth — X-API-Key/Authorization header when present,
    // session cookie otherwise (see app/api/search/route.ts).
    const { userId } = await requireDualAuth(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      // Union of both callers' needs: `approvable_id` for cmd_844's
      // round scoping, `approvable.creator_id` for the requestor check,
      // and `approval_flow.entity_name` for cmd_841's on_withdrawn
      // dispatch. `status` is deliberately NOT selected -- cmd_844
      // replaced the per-row "this request must be pending" guard with
      // the round-level pendingRows check below, because a round may be
      // withdrawn while some of its earlier stages are already approved.
      select: {
        approvable_id: true,
        approvable: { select: { creator_id: true } },
        approval_flow: { select: { entity_name: true } },
      },
    });
    if (!req) throw new ApiError(404, 'Approval request not found');

    // cmd_865: entities that never declare x-approval.on_withdrawn have no
    // resubmission-safe path back out of the 'withdrawn' state (see
    // subtask_865a's ko_withdraw_lockout_design) -- block the withdrawal
    // itself rather than let it silently no-op inside dispatchOnWithdrawn.
    // ENTITIES_WITH_ON_WITHDRAWN is keyed by Prisma MODEL name (same as
    // dispatchOnWithdrawn's modelName param below), while
    // approval_flow.entity_name is a VIEW key that a proxy view can share
    // across models (cmd_818) -- resolve the model first, same as
    // actions_core.ts's withdrawApprovalRequest, rather than matching the
    // raw view key against the model-keyed Set.
    const modelName = req.approval_flow ? resolveApprovableModel(req.approval_flow.entity_name) : null;
    if (!modelName || !ENTITIES_WITH_ON_WITHDRAWN.has(modelName)) {
      throw new ApiError(
        400,
        `Withdrawal is not supported for this entity: declare x-approval.on_withdrawn in the schema to enable withdrawal. (entity: ${req.approval_flow?.entity_name ?? 'unknown'})`,
      );
    }

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

      // cmd_923b: pre-withdrawal dispatch, before any write in this
      // transaction -- a throw here rejects the withdrawal attempt
      // entirely. modelName is guaranteed non-null here, same as the
      // dispatchOnWithdrawn call below.
      await dispatchBeforeWithdraw(tx, modelName, req.approvable_id, userId);

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
      // cmd_841: mirror lib/approval_request/actions_core.ts's
      // withdrawApprovalRequest() -- an entity may declare
      // x-approval.on_withdrawn.set_fields to write its own approvable-side
      // field back to a user-selectable value on withdrawal. This REST
      // route duplicates that function's transaction for dual-auth support
      // (see the parity note in app/api/approval_request/[id]/approve/route.ts,
      // cmd_479/cmd_541) and must stay in parity with it the same way.
      // cmd_844 merge: the approvable id now comes from `req` rather than a
      // single-row update `result`, which this route no longer performs.
      // cmd_865: modelName is guaranteed non-null here -- resolved and
      // Set-checked above, before this transaction opened.
      await dispatchOnWithdrawn(tx, modelName, req.approvable_id);
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
