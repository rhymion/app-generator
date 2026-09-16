import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { notify } from '@/lib/_notifier';
import { notifyApprovalOrderReached } from '@/lib/_notifyApprovalRequest';
import { findNewlyActionableFollowFlowIds } from '@/lib/approval_request/order-check';
import { revalidatePath } from 'next/cache';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';

// approval_history.pre_status/post_status are separate legacy Int columns
// (ordinal snapshot, out of Class A Batch A1 scope) — this maps the
// ApprovalRequestStatus enum back to its historical ordinal index.
const APPROVAL_REQUEST_STATUS_ORDER = ['pending', 'approved', 'rejected', 'terminal_rejected', 'withdrawn'] as const;
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
  // cmd_818: entityName (approval_flow.entity_name) is a VIEW key — a proxy
  // view may share its Prisma model with other views, so x-approval's
  // per-model dispatch config (on_approved_dispatch/on_rejected_dispatch,
  // keyed by model — x-approval is a raw-entity-level declaration) needs a
  // translation step first. resolveApprovableModel(entityName) returns the
  // Prisma model that entityName's view resolves to.
  resolveApprovableModel: (entityName: string) => string | null;
  dispatchOnApproved: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
    userId: string,
  ) => Promise<void>;
  dispatchOnRejected: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
    userId: string,
  ) => Promise<void>;
  isTerminalReject: (modelName: string) => boolean;
  dispatchOnWithdrawn: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
  ) => Promise<void>;
  // cmd_865: entities that never declare x-approval.on_withdrawn have no
  // resubmission-safe path back out of 'withdrawn' -- withdrawApprovalRequest
  // must block the withdrawal itself, not just let dispatchOnWithdrawn no-op.
  hasOnWithdrawn: (modelName: string) => boolean;
  // cmd_923b: pre-action validation dispatch -- called BEFORE the
  // approval_request status write, inside the same transaction, so a throw
  // rejects the action entirely. Symmetric to the dispatchOn*/after-hook
  // dispatchers above, but unconditional (see on_before_approve_dispatch.ts
  // .jinja2's own doc for why these aren't emit_hook-gated).
  dispatchBeforeApprove: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
    actorId: string,
  ) => Promise<void>;
  dispatchBeforeReject: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
    actorId: string,
  ) => Promise<void>;
  dispatchBeforeWithdraw: (
    tx: TransactionClient,
    modelName: string,
    approvableId: string,
    actorId: string,
  ) => Promise<void>;
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
    targetId: string | null;
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
      targetId: target?.id ?? null,
      href: target ? `/${entityName}/view/${target.id}` : undefined,
    };
  }

  /**
   * cmd_491: revalidatePath('/approval_request') never matched anything —
   * there is no /approval_request page, and ApprovalSection.tsx is mounted
   * on the *target* entity's own view/edit pages (x-custom-components
   * target: [view, edit], see docs/knowledge/code-generation-custom-
   * extensions.md §2). revalidatePath silently no-ops on a non-matching
   * path, so this was dead code, not a caught exception. Mirrors the
   * dynamic-segment form code_generator/templates/attachment_actions.ts.jinja2
   * already uses for the same cross-entity-invalidation shape.
   */
  function revalidateApprovableTarget(entityName: string | null, targetId: string | null): void {
    if (!entityName || !targetId) return;
    revalidatePath(`/[locale]/${entityName}/view/${targetId}`, 'page');
    revalidatePath(`/[locale]/${entityName}/edit/${targetId}`, 'page');
  }

  // cmd_540: this server action is reachable directly (Next.js Server Action
  // RPC) from any authenticated client — ApprovalSection.tsx's
  // `precedingApproved` check only hides the button, it enforces nothing
  // server-side. assertApprovalOrder() is the same ordering gate the REST
  // route (app/api/approval_request/[id]/approve/route.ts) already calls;
  // reusing it here (rather than reimplementing) keeps the rejection wording
  // identical between both entry points.
  async function approveApprovalRequest(id: string, message?: string): Promise<void> {
    await assertApproverRole(id);
    await assertApprovalOrder(id);
    const userId = await getSessionUserIdOrThrow();
    let orderReachedFlowIds: string[] = [];
    let orderReachedApprovableId: string | undefined;
    await prisma.$transaction(async (tx) => {
      const before = await tx.approval_request.findUnique({
        where: { id },
        select: {
          status: true,
          approval_flow_id: true,
          round_id: true,
          // cmd_923b: needed to resolve the pre-approval dispatch target
          // BEFORE the status write below -- see dispatchBeforeApprove call.
          approvable_id: true,
          approval_flow: { select: { entity_name: true } },
        },
      });
      if (before?.approval_flow) {
        const _beforeModelName = deps.resolveApprovableModel(before.approval_flow.entity_name);
        if (_beforeModelName) {
          await deps.dispatchBeforeApprove(tx, _beforeModelName, before.approvable_id, userId);
        }
      }
      const req = await tx.approval_request.update({
        where: { id },
        data: { status: 'approved' },
        select: {
          status: true,
          approvable_id: true,
          round_id: true,
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
      // Fire-once: check if every approval_request row of THIS ROUND is now
      // approved (cmd_844: round_id-scoped -- otherwise a prior round's
      // non-approved row, or a stale approved row from a round that never
      // fully completed, would pollute this check once resubmission makes
      // more than one round's worth of rows exist for the same approvable).
      const currentRoundRequests = await tx.approval_request.findMany({
        where: { approvable_id: req.approvable_id, round_id: req.round_id },
        select: { status: true },
      });
      const approvableData = await tx.approvable.findUnique({
        where: { id: req.approvable_id },
        select: { id: true, approved_at: true },
      });
      const allApproved = currentRoundRequests.every((r) => r.status === 'approved');
      const alreadyFired = approvableData?.approved_at != null;
      if (allApproved && !alreadyFired && approvableData) {
        // Set approved_at first (idempotency flag — prevents double-fire on concurrent requests)
        await tx.approvable.update({
          where: { id: approvableData.id },
          data: { approved_at: new Date() },
        });
        const _modelName = deps.resolveApprovableModel(req.approval_flow.entity_name);
        if (_modelName) {
          await deps.dispatchOnApproved(tx, _modelName, approvableData.id, userId);
        }
      }
      // cmd_541: a preceded_by chain creates every flow's approval_request
      // up front, but a follow-on flow isn't actionable until its preceding
      // flow(s) are approved. `before.status !== 'approved'` guards against
      // re-notifying if this same request is approved a second time (e.g. a
      // retried request) — findNewlyActionableFollowFlowIds() would
      // otherwise recompute the same already-satisfied ordering as "new"
      // every time.
      if (before && before.status !== 'approved') {
        orderReachedFlowIds = await findNewlyActionableFollowFlowIds(tx, req.approvable_id, before.approval_flow_id, before.round_id);
        orderReachedApprovableId = req.approvable_id;
      }
    });
    // Fire-and-forget notification (trigger #3): the requester learns the
    // outcome without sharing the approval_history transaction.
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
    // Fire-and-forget notification (trigger #4, cmd_541): approvers of any
    // follow-on flow that just became actionable. Reuses the same
    // approvable-target link (entityName/targetId) already resolved above.
    if (orderReachedApprovableId && orderReachedFlowIds.length > 0) {
      await notifyApprovalOrderReached(prisma, orderReachedApprovableId, orderReachedFlowIds, {
        excludeUserId: userId,
        targetEntityName: entityName,
        targetId,
      });
    }
    revalidateApprovableTarget(entityName, targetId);
  }

  async function rejectApprovalRequest(
    id: string,
    message?: string,
    options?: { reason?: string; reasonKind?: number },
  ): Promise<void> {
    await assertApproverRole(id);
    await assertApprovalOrder(id);
    const userId = await getSessionUserIdOrThrow();
    let newStatus: 'rejected' | 'terminal_rejected' = 'rejected';
    await prisma.$transaction(async (tx) => {
      const req = await tx.approval_request.findUnique({
        where: { id },
        select: {
          round_id: true,
          approvable_id: true,
          approval_flow: { select: { entity_name: true } },
        },
      });
      if (!req?.approval_flow) throw new Error('Approval request not found');

      const _modelName = deps.resolveApprovableModel(req.approval_flow.entity_name);
      const terminal = _modelName != null && deps.isTerminalReject(_modelName);
      newStatus = terminal ? 'terminal_rejected' : 'rejected';

      // cmd_923b: pre-rejection dispatch, before any write in this
      // transaction -- a throw here rejects the rejection attempt entirely.
      if (_modelName && req.approvable_id) {
        await deps.dispatchBeforeReject(tx, _modelName, req.approvable_id, userId);
      }

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

      // cmd_844 PD-2 (cmd_863c fix: unconditional on terminal-ness -- see
      // below): a rejection closes this whole round -- any other still-
      // pending row in the same round (a later stage that never got its
      // turn) is auto-cancelled to 'withdrawn' (the existing status value
      // is reused, not a new 'cancelled' one -- who closed it is recorded
      // via approval_history.creator_id, the rejecting approver). Without
      // this, a still-pending sibling row lingers forever in the approver's
      // pending-approvals view even though the round it belongs to has
      // already ended -- an orphaned row nothing will ever act on again.
      //
      // cmd_863c: originally gated on `if (!terminal)` (cmd_844's own
      // reasoning was "'terminal_rejected' alone already blocks
      // canSubmitForApproval, and the entity's own on_rejected dispatch
      // ends the flow through a separate mechanism"), but that reasoning
      // only covers *resubmission* being blocked -- it says nothing about
      // the sibling approval_request row itself, which the entity's
      // on_rejected dispatch never touches (it writes the ENTITY's own
      // field, not another approval_request's status). A terminal
      // rejection ends the round exactly as finally as a non-terminal one,
      // so the sibling auto-cancel must run for both -- this is what
      // 14.3M(b) (generated unconditionally of terminal-ness) actually
      // asserts, and what left it failing (`expected 'pending' to equal
      // 'withdrawn'`) for every terminal-on_rejected entity in the proj_c
      // consumer schema (approval_edit_terminal_test/inventory_adjustment/
      // inventory_movement).
      const siblingPending = await tx.approval_request.findMany({
        where: {
          approvable_id: result.approvable_id,
          round_id: req.round_id,
          status: 'pending',
          id: { not: id },
        },
        select: { id: true, status: true },
      });
      if (siblingPending.length > 0) {
        await tx.approval_request.updateMany({
          where: { id: { in: siblingPending.map((r) => r.id) } },
          data: { status: 'withdrawn' },
        });
        await tx.approval_history.createMany({
          data: siblingPending.map((r) => ({
            approval_request_id: r.id,
            pre_status: statusOrdinal(r.status),
            post_status: statusOrdinal('withdrawn'),
            message: null,
            creator_id: userId,
          })),
        });
      }

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
        if (!alreadyFired && approvableData && _modelName) {
          await tx.approvable.update({
            where: { id: approvableData.id },
            data: { approved_at: new Date() },
          });
          await deps.dispatchOnRejected(tx, _modelName, approvableData.id, userId);
        }
      } else if (approvableData && _modelName) {
        await deps.dispatchOnRejected(tx, _modelName, approvableData.id, userId);
      }
    }, { isolationLevel: 'Serializable' });
    const { recipientId, entityName, targetId, href } = await getApprovalRequestRecipient(id);
    if (recipientId && recipientId !== userId) {
      notify(recipientId, 'approval_responded', {
        title: `Your ${entityName ?? 'request'} was rejected`,
        href,
        approvalRequestId: id,
        status: newStatus,
        message: message ?? null,
      });
    }
    revalidateApprovableTarget(entityName, targetId);
  }

  // cmd_825: the requestor withdraws their own still-pending request(s).
  // Unlike approve/reject this is not an approver action -- permission is
  // "you are the person this request was submitted for"
  // (approvable.creator_id, the same field getApprovalRequestRecipient
  // already treats as the requestor), never approval_flow.approver_role_id
  // membership. The edge-trigger's positive predicate (cmd_826) then
  // treats a withdrawn round as an eligible starting point for a future
  // resubmission, same as a non-terminal rejection.
  //
  // cmd_841: unlike before, withdrawal now DOES carry an
  // on_withdrawn-style dispatch (see dispatchOnWithdrawn below) -- an
  // entity may declare x-approval.on_withdrawn.set_fields to write its own
  // approvable-side field (e.g. status: 'draft') back to a
  // user-selectable, non-locked value on withdrawal, closing the gap where
  // a withdrawn request left no way back to resubmission (cmd_840).
  //
  // cmd_844: withdrawal is now round-scoped, not single-row. A multistage
  // round can have some stages already 'approved' when the requestor
  // withdraws -- the final ruling on PD-1 is round_id scoping ALONE:
  // approved rows are never rewritten (their approval history stays
  // intact), only the round's remaining 'pending' rows are closed to
  // 'withdrawn'. A round with nothing pending left has nothing to
  // withdraw (canWithdrawApproval, lib/approval_request/
  // submit_predicate.ts, mirrors this exact rule client-side).
  async function assertRequestorSelf(approvableId: string): Promise<void> {
    const approvable = await prisma.approvable.findUnique({
      where: { id: approvableId },
      select: { creator_id: true },
    });
    if (!approvable) throw new Error('Approvable not found');
    const userId = await getSessionUserIdOrThrow();
    if (approvable.creator_id !== userId) {
      throw new Error('Access denied: only the requestor may withdraw their own request');
    }
  }

  async function withdrawApprovalRequest(approvableId: string, message?: string): Promise<void> {
    await assertRequestorSelf(approvableId);
    const userId = await getSessionUserIdOrThrow();
    let anchorRequestId: string | undefined;
    await prisma.$transaction(async (tx) => {
      const latestRoundRow = await tx.approval_request.findFirst({
        where: { approvable_id: approvableId },
        orderBy: { created_at: 'desc' },
        select: { round_id: true },
      });
      if (!latestRoundRow) throw new Error('No approval request found');

      const pendingRows = await tx.approval_request.findMany({
        where: { approvable_id: approvableId, round_id: latestRoundRow.round_id, status: 'pending' },
        select: { id: true, status: true, approval_flow: { select: { entity_name: true } } },
      });
      if (pendingRows.length === 0) throw new Error('No pending requests to withdraw');
      anchorRequestId = pendingRows[0].id;

      // cmd_865: resolved here (before any write in this transaction) so the
      // on_withdrawn-declaration check below is fail-fast -- no row has been
      // touched yet if this throws. Reused for dispatchOnWithdrawn below so
      // resolveApprovableModel is not called twice for the same entity_name.
      const entityName = pendingRows[0].approval_flow?.entity_name ?? null;
      const _modelName = entityName ? deps.resolveApprovableModel(entityName) : null;
      if (!_modelName || !deps.hasOnWithdrawn(_modelName)) {
        throw new Error(
          `Withdrawal is not supported for this entity type (on_withdrawn not declared): ${_modelName ?? entityName ?? 'unknown'}`,
        );
      }

      // cmd_923b: pre-withdrawal dispatch, before any write in this
      // transaction -- a throw here rejects the withdrawal attempt entirely.
      await deps.dispatchBeforeWithdraw(tx, _modelName, approvableId, userId);

      await tx.approval_request.updateMany({
        where: { id: { in: pendingRows.map((r) => r.id) } },
        data: { status: 'withdrawn' },
      });
      // cmd_844: pre_status is read off each row's actual prior status
      // (guaranteed 'pending' by the query above) rather than a hardcoded
      // literal -- see the pre_status-direct-write fix this task's
      // acceptance criteria required for both this loop and reject's
      // sibling auto-cancel above.
      await tx.approval_history.createMany({
        data: pendingRows.map((r) => ({
          approval_request_id: r.id,
          pre_status: statusOrdinal(r.status),
          post_status: statusOrdinal('withdrawn'),
          message: message ?? null,
          creator_id: userId,
        })),
      });

      await deps.dispatchOnWithdrawn(tx, _modelName, approvableId);
    }, { isolationLevel: 'Serializable' });
    const { entityName, targetId } = anchorRequestId
      ? await getApprovalRequestRecipient(anchorRequestId)
      : { entityName: null, targetId: null };
    revalidateApprovableTarget(entityName, targetId);
  }

  return {
    getApprovalRequestRecipient,
    approveApprovalRequest,
    rejectApprovalRequest,
    withdrawApprovalRequest,
  };
}
