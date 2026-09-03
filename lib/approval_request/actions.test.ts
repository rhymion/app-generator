import { describe, it, expect, beforeEach, vi } from 'vitest';

// cmd_479: getApprovalRequestRecipient() builds the Trigger #3
// (approval_responded) notification href generically via
// resolveApprovableTarget(entityName, approvableId) — it must never fall
// back to `/approval_request/view/{id}`, which has no detail page.
//
// cmd_489: actions_core.ts takes the generator-emitted collaborators
// (resolve_target/on_approved_dispatch/on_rejected_dispatch, PR #203) as
// injected deps rather than static imports, so this test builds its subject
// via createApprovalActions() with hand-written fakes. Neither this file nor
// actions_core.ts imports the generated modules, so this test runs unchanged
// in a checkout that has not run `npm run generate-code`. See
// docs/knowledge/troubleshooting.md §2.4.
//
// cmd_844: canSubmitForApproval/canWithdrawApproval and the withdraw/reject
// actions became round-scoped -- approveApprovalRequest now reads "is the
// whole round approved" via a fresh tx.approval_request.findMany() (not the
// old approvable.approval_requests nested include), withdrawApprovalRequest
// takes an approvable id and closes every pending row of the current round
// via updateMany/createMany, and rejectApprovalRequest auto-cancels the
// round's other pending rows regardless of terminal-ness (PD-2, cmd_863c
// fix). See lib/approval_request/actions_core.ts's doc comments for the
// full design.

const {
  findUnique, findFirst, arUpdate, arUpdateMany, historyCreate, historyCreateMany,
  approvableFindUnique, approvableFindUniqueOuter, approvableUpdate, transactionMock, revalidatePathMock,
  txFlowFindUnique, txArFindMany, prismaArFindMany, prismaRoleFindUnique,
  notifyMock, notifyApprovalRequestCreatedMock,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  arUpdate: vi.fn(),
  arUpdateMany: vi.fn(),
  historyCreate: vi.fn(),
  historyCreateMany: vi.fn(),
  approvableFindUnique: vi.fn(),
  // cmd_844: assertRequestorSelf() now queries prisma.approvable.findUnique
  // directly (approvableId is the withdraw entry point's own argument, no
  // approval_request row needed) -- a separate mock from approvableFindUnique
  // (the tx-scoped approvable lookup approve/reject also use), since one is
  // on the outer `prisma` client and the other is on `tx`.
  approvableFindUniqueOuter: vi.fn(),
  approvableUpdate: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  // cmd_541: findNewlyActionableFollowFlowIds() (called inside the tx) and
  // notifyApprovalOrderReached() (called after, against the top-level
  // prisma client) each need their own approval_flow/approval_request/role
  // lookups — separate mocks so the tx-scoped call and the post-tx call
  // don't shadow each other's return values.
  txFlowFindUnique: vi.fn(),
  txArFindMany: vi.fn(),
  prismaArFindMany: vi.fn(),
  prismaRoleFindUnique: vi.fn(),
  notifyMock: vi.fn(),
  notifyApprovalRequestCreatedMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    approval_request: { findUnique, update: arUpdate, findMany: prismaArFindMany },
    approvable: { findUnique: approvableFindUniqueOuter },
    role: { findUnique: prismaRoleFindUnique },
    $transaction: transactionMock,
  },
}));
vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow: vi.fn(), getUserRoleIds: vi.fn() }));
vi.mock('@/lib/_notifier', () => ({ notify: notifyMock }));
// notifyApprovalOrderReached (cmd_541) is intentionally NOT mocked here — its
// real implementation runs, calling through to the mocked notify() above, so
// the order-reached tests can assert on that call directly. Only
// notifyApprovalRequestCreated (cmd_539) is replaced.
vi.mock('@/lib/_notifyApprovalRequest', async (importOriginal) => ({
  ...(await importOriginal()),
  notifyApprovalRequestCreated: notifyApprovalRequestCreatedMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
// cmd_540: assertApprovalOrder() (lib/approval_request/order-check.ts) queries
// prisma.approval_request.findMany() directly, which this file's minimal
// prisma mock (above) doesn't define — mocked to a no-op here since order
// enforcement itself is covered by test/flows/approval_order_bypass.test.ts
// (real DB) and this file's own focus (recipient/revalidate targeting) is
// orthogonal to it. Preserves the module's other export
// (findNewlyActionableFollowFlowIds, cmd_541) via importOriginal — a bare
// factory here would replace the whole module and break that test group.
vi.mock('@/lib/approval_request/order-check', async (importOriginal) => ({
  ...(await importOriginal()),
  assertApprovalOrder: vi.fn().mockResolvedValue(undefined),
}));

import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { notify } from '@/lib/_notifier';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';
import { createApprovalActions } from './actions_core';

const resolveApprovableTarget = vi.fn();
// cmd_818: entity_name (approval_flow.entity_name) is now a view key —
// dispatchOnApproved/dispatchOnRejected/isTerminalReject are keyed by
// Prisma model instead, so actions_core.ts translates through this first.
// Every fixture below uses entity_name === model (parent == model), so the
// default identity mapping keeps existing assertions unchanged.
const resolveApprovableModel = vi.fn((name: string): string | null => name);
const dispatchOnApproved = vi.fn();
const dispatchOnRejected = vi.fn();
const isTerminalReject = vi.fn(() => false);
// cmd_841: withdrawal's own dispatch counterpart to dispatchOnApproved/
// dispatchOnRejected above -- keyed by model, same as those.
const dispatchOnWithdrawn = vi.fn();
// cmd_865: defaults to true so every pre-existing withdraw test (written
// before the withdraw lockout existed) keeps exercising the same "entity
// declares on_withdrawn" case it always implicitly assumed; the lockout
// itself is covered by dedicated tests below with this mocked false.
const hasOnWithdrawn = vi.fn(() => true);
// cmd_923b: pre-action validation dispatchers -- called before any write in
// approve/reject/withdraw's own transaction. Default no-op resolves void,
// same as the after-hook dispatch mocks above.
const dispatchBeforeApprove = vi.fn();
const dispatchBeforeReject = vi.fn();
const dispatchBeforeWithdraw = vi.fn();

const {
  getApprovalRequestRecipient, approveApprovalRequest, rejectApprovalRequest, withdrawApprovalRequest,
} = createApprovalActions({
  resolveApprovableTarget,
  resolveApprovableModel,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
  dispatchOnWithdrawn,
  hasOnWithdrawn,
  dispatchBeforeApprove,
  dispatchBeforeReject,
  dispatchBeforeWithdraw,
});

// Fake tx client shared by every prisma.$transaction(cb) call in
// approve/reject/withdraw — cb receives this in place of a real transaction.
const fakeTx = {
  approval_request: { update: arUpdate, updateMany: arUpdateMany, findUnique, findMany: txArFindMany, findFirst },
  approval_history: { create: historyCreate, createMany: historyCreateMany },
  approvable: { findUnique: approvableFindUnique, update: approvableUpdate },
  approval_flow: { findUnique: txFlowFindUnique },
};

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  arUpdate.mockReset();
  arUpdateMany.mockReset();
  historyCreate.mockReset();
  historyCreateMany.mockReset();
  approvableFindUnique.mockReset();
  approvableFindUniqueOuter.mockReset();
  approvableUpdate.mockReset();
  revalidatePathMock.mockReset();
  resolveApprovableTarget.mockReset();
  resolveApprovableModel.mockReset().mockImplementation((name: string) => name);
  dispatchOnApproved.mockReset();
  dispatchOnRejected.mockReset();
  isTerminalReject.mockReset().mockReturnValue(false);
  dispatchOnWithdrawn.mockReset();
  hasOnWithdrawn.mockReset().mockReturnValue(true);
  dispatchBeforeApprove.mockReset();
  dispatchBeforeReject.mockReset();
  dispatchBeforeWithdraw.mockReset();
  transactionMock.mockReset().mockImplementation(async (cb) => cb(fakeTx));
  vi.mocked(getSessionUserIdOrThrow).mockReset().mockResolvedValue('user-1');
  vi.mocked(getUserRoleIds).mockReset().mockResolvedValue(['approver-role']);
  // Default: no follow-on flows for the just-approved flow, so existing
  // tests that don't care about cmd_541's order-reached notification see no
  // behavior change (findNewlyActionableFollowFlowIds() short-circuits on
  // an empty `followed_by`).
  txFlowFindUnique.mockReset().mockResolvedValue({ followed_by: [] });
  // cmd_844: tx.approval_request.findMany() now serves THREE distinct call
  // sites depending on which action is under test (approveApprovalRequest's
  // currentRoundRequests query, findNewlyActionableFollowFlowIds' sibling
  // lookup, and rejectApprovalRequest's sibling-pending auto-cancel query) —
  // each test below sets it explicitly to the shape that call site needs.
  // Default empty: harmless for reject (no siblings to auto-cancel) and for
  // order-reached (no unblocked follow-on flows); approve tests must set
  // their own round rows explicitly (see note on Array.prototype.every's
  // vacuous truth on an empty array).
  txArFindMany.mockReset().mockResolvedValue([]);
  prismaArFindMany.mockReset().mockResolvedValue([]);
  prismaRoleFindUnique.mockReset().mockResolvedValue(null);
  vi.mocked(assertApprovalOrder).mockReset().mockResolvedValue(undefined);
  notifyMock.mockReset();
  notifyApprovalRequestCreatedMock.mockReset();
});

// cmd_818 (D1): resubmitApprovalRequest() is retired -- re-submission is no
// longer a dedicated approval_request status flip. It is now: the entity's
// own status field is edited back to x-approval.submit_on's target value
// (an ordinary update through the entity's own service layer), which fires
// the update-time edge trigger and creates a fresh approval_request. See
// code_generator/tests/test_approval_edge_trigger.py for that mechanism's
// coverage. This describe block, and its notifyApprovalRequestCreated-on-
// resubmit assertion, are gone along with the function.

// cmd_539: the post-transaction Trigger #3 notify() call hard-coded
// `status: 'rejected'` even when the actual outcome was
// `terminal_rejected` — the notification fired either way, but its
// payload misreported the outcome. Pins the fix: the payload's status
// must match what isTerminalReject() decided.
describe('rejectApprovalRequest notify payload status (cmd_539)', () => {
  // rejectApprovalRequest() reads approval_request via findUnique three
  // times in sequence: (1) assertApproverRole's permission check, (2) the
  // in-transaction lookup used to decide terminal vs non-terminal (now also
  // carrying round_id, cmd_844), (3) getApprovalRequestRecipient() after the
  // transaction commits. Each call only needs a subset of fields, but all
  // three must resolve for the whole flow to complete without throwing.
  const stubRejectLookups = () => {
    findUnique.mockReset();
    findUnique
      .mockResolvedValueOnce({ approval_flow: { approver_role_id: 'approver-role' } })
      .mockResolvedValueOnce({ round_id: 'round-1', approval_flow: { entity_name: 'leave_request' } })
      .mockResolvedValueOnce({
        approvable_id: 'appr-1',
        approval_flow: { entity_name: 'leave_request' },
        approvable: { creator_id: 'creator-1' },
      });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });
  };

  it('reports status: rejected for a non-terminal rejection', async () => {
    stubRejectLookups();
    isTerminalReject.mockReturnValue(false);
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: 'appr-1' });

    await rejectApprovalRequest('req-1');

    expect(notifyMock).toHaveBeenCalledWith(
      'creator-1',
      'approval_responded',
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('reports status: terminal_rejected for a terminal rejection', async () => {
    stubRejectLookups();
    isTerminalReject.mockReturnValue(true);
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'terminal_rejected', approvable_id: 'appr-1' });

    await rejectApprovalRequest('req-1');

    expect(notifyMock).toHaveBeenCalledWith(
      'creator-1',
      'approval_responded',
      expect.objectContaining({ status: 'terminal_rejected' }),
    );
  });
});

describe('getApprovalRequestRecipient (cmd_479)', () => {
  it('builds href from the resolved target entity + id', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'creator-1' },
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });

    const result = await getApprovalRequestRecipient('req-1');

    expect(resolveApprovableTarget).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1');
    expect(result).toEqual({
      recipientId: 'creator-1',
      entityName: 'leave_request',
      targetId: 'lr-42',
      href: '/leave_request/view/lr-42',
    });
  });

  it('never returns an /approval_request/view/ href', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'creator-1' },
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });

    const { href } = await getApprovalRequestRecipient('req-1');

    expect(href).not.toMatch(/^\/approval_request\/view\//);
  });

  it('omits href when the target cannot be resolved', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'creator-1' },
    });
    resolveApprovableTarget.mockResolvedValue(null);

    const { href } = await getApprovalRequestRecipient('req-1');

    expect(href).toBeUndefined();
  });

  it('returns null fields when the approval_request has no approvable bridge', async () => {
    findUnique.mockResolvedValue({
      approvable_id: null,
      approval_flow: { entity_name: 'leave_request' },
      approvable: null,
    });

    const result = await getApprovalRequestRecipient('req-1');

    expect(resolveApprovableTarget).not.toHaveBeenCalled();
    expect(result).toEqual({ recipientId: null, entityName: 'leave_request', targetId: null, href: undefined });
  });
});

// cmd_491: revalidatePath('/approval_request') matched no real route (there
// is no /approval_request page — ApprovalSection.tsx mounts on the target
// entity's own view/edit pages) and so silently invalidated nothing. These
// tests pin the fixed behavior: approve/reject must revalidate the
// resolved target entity's view AND edit pages, using the same
// `/[locale]/{entity}/{view|edit}/{id}` + 'page' form the neighboring
// attachment_actions.ts.jinja2 template already uses for the identical
// cross-entity-invalidation shape.
describe('revalidatePath targeting (cmd_491)', () => {
  const stubApprovalFlowLookup = () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: {
        entity_name: 'leave_request',
        approver_role_id: 'approver-role',
        requestor_role_id: 'requestor-role',
      },
      approvable: { creator_id: 'user-1' },
      status: 'rejected',
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });
  };

  it('approveApprovalRequest revalidates the target entity view + edit pages', async () => {
    stubApprovalFlowLookup();
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request' },
    });
    txArFindMany.mockResolvedValue([{ status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: new Date() });

    await approveApprovalRequest('req-1');

    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/view/lr-42', 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/edit/lr-42', 'page');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/approval_request');
  });

  it('rejectApprovalRequest revalidates the target entity view + edit pages', async () => {
    stubApprovalFlowLookup();
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: 'appr-1' });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });

    await rejectApprovalRequest('req-1');

    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/view/lr-42', 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/edit/lr-42', 'page');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/approval_request');
  });

  it('skips revalidation when the target cannot be resolved (no approvable bridge)', async () => {
    findUnique.mockResolvedValue({
      approvable_id: null,
      round_id: 'round-1',
      approval_flow: {
        entity_name: 'leave_request',
        approver_role_id: 'approver-role',
      },
      approvable: null,
      status: 'rejected',
    });
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: null });
    approvableFindUnique.mockResolvedValue(null);

    await rejectApprovalRequest('req-1');

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

// cmd_541: a preceded_by chain creates every flow's approval_request up
// front (Trigger #2 notifies all their approvers then), but a follow-on
// flow isn't actionable until its preceding flow(s) are approved — and
// nothing told those approvers when that moment arrived. Covers the server
// action path (ApprovalSection.tsx -> actions.ts -> actions_core.ts);
// the REST route (app/api/approval_request/[id]/approve/route.ts) is
// covered by cypress/e2e/api/multi_stage_approval_order_reached.cy.ts —
// see cmd_479 on why both independent implementations need this.
describe('approveApprovalRequest order-reached notification (cmd_541)', () => {
  function stubApprovingFlow1() {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow_id: 'flow-1',
      round_id: 'round-1',
      status: 'pending',
      approval_flow: { approver_role_id: 'approver-role', entity_name: 'user' },
      approvable: { creator_id: 'requester-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'user' },
    });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableTarget.mockResolvedValue({ id: 'user-99' });
  }

  it('notifies the newly-actionable follow-on flow\'s approver role', async () => {
    stubApprovingFlow1();
    // flow-2 is preceded_by only flow-1 (the one just approved), and
    // flow-1's sibling approval_request is already 'approved' — so flow-2
    // just became fully unblocked. This same array serves BOTH
    // approveApprovalRequest's currentRoundRequests query (call #1) and
    // findNewlyActionableFollowFlowIds' sibling lookup (call #2) —
    // {status: 'approved'} alone happens to be a not-yet-fully-approved
    // round (this test doesn't assert dispatchOnApproved either way), so
    // only the order-reached call's shape matters here.
    txFlowFindUnique.mockResolvedValue({ followed_by: [{ id: 'flow-2', preceded_by: [{ id: 'flow-1' }] }] });
    txArFindMany.mockResolvedValue([{ approval_flow_id: 'flow-1', status: 'approved' }]);
    prismaArFindMany.mockResolvedValue([
      { id: 'req-2', approval_flow: { approver_role_id: 'approver-2-role', entity_name: 'user' } },
    ]);
    prismaRoleFindUnique.mockResolvedValue({ users: [{ id: 'approver-2-user' }] });

    await approveApprovalRequest('req-1');

    expect(txFlowFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'flow-1' } }));
    expect(notify).toHaveBeenCalledWith(
      'approver-2-user',
      'approval_order_reached',
      expect.objectContaining({ approvalRequestId: 'req-2', entityName: 'user', href: '/user/view/user-99' }),
    );
    expect(vi.mocked(notify).mock.calls.filter((c) => c[1] === 'approval_order_reached')).toHaveLength(1);
  });

  it('does not notify when no follow-on flow is unblocked yet (default: no followed_by)', async () => {
    stubApprovingFlow1();
    txArFindMany.mockResolvedValue([{ status: 'approved' }]);
    // Default beforeEach mocks: followed_by: [] — nothing depends on flow-1.

    await approveApprovalRequest('req-1');

    expect(vi.mocked(notify).mock.calls.filter((c) => c[1] === 'approval_order_reached')).toHaveLength(0);
  });

  it('does not re-notify when the request was already approved (idempotency guard)', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow_id: 'flow-1',
      round_id: 'round-1',
      status: 'approved', // already approved before this call
      approval_flow: { approver_role_id: 'approver-role', entity_name: 'user' },
      approvable: { creator_id: 'requester-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'user' },
    });
    txArFindMany.mockResolvedValue([{ status: 'approved' }, { status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: new Date() });
    // Even if a follow-on flow would otherwise look unblocked, the
    // before.status !== 'approved' guard must skip the lookup entirely.
    txFlowFindUnique.mockResolvedValue({ followed_by: [{ id: 'flow-2', preceded_by: [{ id: 'flow-1' }] }] });

    await approveApprovalRequest('req-1');

    expect(txFlowFindUnique).not.toHaveBeenCalled();
    expect(vi.mocked(notify).mock.calls.filter((c) => c[1] === 'approval_order_reached')).toHaveLength(0);
  });
});

// cmd_844: approveApprovalRequest's "fire on_approved once" check moved
// from an unscoped approvable.approval_requests include to a round_id-
// scoped tx.approval_request.findMany() query — pins that a stale/other
// round's rows never leak into this decision.
describe('approveApprovalRequest round-scoped allApproved (cmd_844)', () => {
  const stubApprovingLastStage = () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow_id: 'flow-2',
      round_id: 'round-2',
      status: 'pending',
      approval_flow: { approver_role_id: 'approver-role', entity_name: 'leave_request' },
      approvable: { creator_id: 'requester-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-2',
      approval_flow: { entity_name: 'leave_request' },
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-1' });
  };

  it('queries the current round only (round_id in the where clause)', async () => {
    stubApprovingLastStage();
    txArFindMany.mockResolvedValue([{ status: 'approved' }, { status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });

    await approveApprovalRequest('req-1');

    expect(txArFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { approvable_id: 'appr-1', round_id: 'round-2' } }),
    );
  });

  it('fires dispatchOnApproved once every row of the current round is approved', async () => {
    stubApprovingLastStage();
    txArFindMany.mockResolvedValue([{ status: 'approved' }, { status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });

    await approveApprovalRequest('req-1');

    expect(approvableUpdate).toHaveBeenCalledWith({
      where: { id: 'appr-1' },
      data: { approved_at: expect.any(Date) },
    });
    expect(dispatchOnApproved).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1', 'user-1');
  });

  it('does not fire dispatchOnApproved while the current round still has a non-approved row', async () => {
    stubApprovingLastStage();
    // A stale row from an OLD round would leak in here under the pre-cmd_844
    // unscoped query -- this array represents the CURRENT round only, still
    // missing an approval on another stage.
    txArFindMany.mockResolvedValue([{ status: 'approved' }, { status: 'pending' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });

    await approveApprovalRequest('req-1');

    expect(dispatchOnApproved).not.toHaveBeenCalled();
  });
});

// cmd_540: the REST route (app/api/approval_request/[id]/{approve,reject}/
// route.ts) enforces multi-stage ordering via assertApprovalOrder(), but
// this server action didn't call it at all — reachable directly via Next.js
// Server Action RPC, bypassing the UI's client-side-only `precedingApproved`
// gate (ApprovalSection.tsx). These tests pin: the gate is invoked, and a
// rejection from it aborts before the transaction (no partial DB writes).
// The real-DB end-to-end proof (order violation actually blocked, not just
// "the mock was called") lives in test/flows/approval_order_bypass.test.ts.
describe('assertApprovalOrder gate (cmd_540)', () => {
  const stubApproverRoleLookup = () => {
    findUnique.mockResolvedValue({
      approval_flow: { approver_role_id: 'approver-role' },
    });
  };

  it('approveApprovalRequest calls assertApprovalOrder with the request id, before the transaction, and propagates its rejection', async () => {
    stubApproverRoleLookup();
    const { assertApprovalOrder } = await import('@/lib/approval_request/order-check');
    vi.mocked(assertApprovalOrder).mockClear().mockRejectedValue(
      new Error('Preceding approval requests must be approved first'),
    );

    await expect(approveApprovalRequest('req-1')).rejects.toThrow(
      'Preceding approval requests must be approved first',
    );
    expect(assertApprovalOrder).toHaveBeenCalledWith('req-1');
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejectApprovalRequest calls assertApprovalOrder with the request id, before the transaction, and propagates its rejection', async () => {
    stubApproverRoleLookup();
    const { assertApprovalOrder } = await import('@/lib/approval_request/order-check');
    vi.mocked(assertApprovalOrder).mockClear().mockRejectedValue(
      new Error('Preceding approval requests must be approved first'),
    );

    await expect(rejectApprovalRequest('req-1')).rejects.toThrow(
      'Preceding approval requests must be approved first',
    );
    expect(assertApprovalOrder).toHaveBeenCalledWith('req-1');
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// cmd_818 (E6): resubmitApprovalRequest is retired along with its
// dedicated status-flip mechanism (see the D1 comment above).
describe('resubmitApprovalRequest removal (cmd_818 E6)', () => {
  it('is not present on the actions object createApprovalActions returns', () => {
    const actions = createApprovalActions({
      resolveApprovableTarget, resolveApprovableModel, dispatchOnApproved, dispatchOnRejected, isTerminalReject,
      hasOnWithdrawn, dispatchOnWithdrawn, dispatchBeforeApprove, dispatchBeforeReject, dispatchBeforeWithdraw,
    });
    expect('resubmitApprovalRequest' in actions).toBe(false);
  });
});

// cmd_818 (GROUP C5): approval_flow.entity_name is a view key; dispatch to
// on_approved_dispatch/on_rejected_dispatch (keyed by Prisma model, since
// x-approval is a raw-entity-level declaration shared by every view over
// that model) must go through resolveApprovableModel's translation first —
// a proxy view's entity_name and its underlying model are not always the
// same string.
describe('entity_name -> model translation before dispatch (cmd_818 GROUP C5)', () => {
  it('approveApprovalRequest dispatches with the resolved model, not the raw entity_name', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'purchase_request_gate', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'purchase_request_gate' },
    });
    txArFindMany.mockResolvedValue([{ status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableModel.mockImplementation((name: string) =>
      name === 'purchase_request_gate' ? 'purchase_request' : name);
    resolveApprovableTarget.mockResolvedValue({ id: 'pr-1' });

    await approveApprovalRequest('req-1');

    expect(dispatchOnApproved).toHaveBeenCalledWith(expect.anything(), 'purchase_request', 'appr-1', 'user-1');
  });

  it('rejectApprovalRequest resolves isTerminalReject/dispatchOnRejected against the model, not the view key', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'purchase_request_gate', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: 'appr-1' });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableModel.mockImplementation((name: string) =>
      name === 'purchase_request_gate' ? 'purchase_request' : name);
    resolveApprovableTarget.mockResolvedValue({ id: 'pr-1' });

    await rejectApprovalRequest('req-1');

    expect(isTerminalReject).toHaveBeenCalledWith('purchase_request');
    expect(dispatchOnRejected).toHaveBeenCalledWith(expect.anything(), 'purchase_request', 'appr-1', 'user-1');
  });

  it('skips dispatch when the view key does not resolve to a model', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'unknown_view', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: 'appr-1' });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableModel.mockReturnValue(null);
    resolveApprovableTarget.mockResolvedValue(null);

    await rejectApprovalRequest('req-1');

    expect(isTerminalReject).not.toHaveBeenCalled();
    expect(dispatchOnRejected).not.toHaveBeenCalled();
  });
});

describe('pre-action dispatch (cmd_923b)', () => {
  it('approveApprovalRequest dispatches beforeApprove before the status write', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request' },
    });
    txArFindMany.mockResolvedValue([{ status: 'approved' }]);
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-1' });

    await approveApprovalRequest('req-1');

    expect(dispatchBeforeApprove).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1', 'user-1');
  });

  it('rolls back the approval when beforeApprove throws', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    dispatchBeforeApprove.mockRejectedValueOnce(new Error('blocked by custom rule'));

    await expect(approveApprovalRequest('req-1')).rejects.toThrow('blocked by custom rule');

    expect(arUpdate).not.toHaveBeenCalled();
    expect(dispatchOnApproved).not.toHaveBeenCalled();
  });

  it('rejectApprovalRequest dispatches beforeReject before the status write', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({ id: 'req-1', status: 'rejected', approvable_id: 'appr-1' });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-1' });

    await rejectApprovalRequest('req-1');

    expect(dispatchBeforeReject).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1', 'user-1');
  });

  it('rolls back the rejection when beforeReject throws', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      round_id: 'round-1',
      approval_flow: { entity_name: 'leave_request', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    dispatchBeforeReject.mockRejectedValueOnce(new Error('blocked by custom rule'));

    await expect(rejectApprovalRequest('req-1')).rejects.toThrow('blocked by custom rule');

    expect(arUpdate).not.toHaveBeenCalled();
    expect(dispatchOnRejected).not.toHaveBeenCalled();
  });
});

// cmd_844 PD-2 (cmd_863c: unconditional on terminal-ness, see
// rejectApprovalRequest's own doc comment): a rejection auto-cancels the
// round's other still-pending rows (status: 'withdrawn', the existing
// value reused rather than a new 'cancelled' one) -- otherwise a
// still-pending sibling row is left orphaned forever, whether the
// rejection that ended the round was terminal or not.
describe('rejectApprovalRequest sibling pending auto-cancel (cmd_844 PD-2)', () => {
  const stubRejectingStage2 = (terminal: boolean) => {
    findUnique.mockReset();
    findUnique
      .mockResolvedValueOnce({ approval_flow: { approver_role_id: 'approver-role' } })
      .mockResolvedValueOnce({ round_id: 'round-1', approval_flow: { entity_name: 'leave_request' } })
      .mockResolvedValueOnce({
        approvable_id: 'appr-1',
        approval_flow: { entity_name: 'leave_request' },
        approvable: { creator_id: 'creator-1' },
      });
    isTerminalReject.mockReturnValue(terminal);
    arUpdate.mockResolvedValue({
      id: 'req-stage2',
      status: terminal ? 'terminal_rejected' : 'rejected',
      approvable_id: 'appr-1',
    });
    approvableFindUnique.mockResolvedValue({ id: 'appr-1', approved_at: null });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-1' });
  };

  it('auto-cancels a still-pending stage-3 row after a non-terminal stage-2 rejection', async () => {
    stubRejectingStage2(false);
    txArFindMany.mockResolvedValue([{ id: 'req-stage3', status: 'pending' }]);

    await rejectApprovalRequest('req-stage2');

    expect(txArFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvable_id: 'appr-1', round_id: 'round-1', status: 'pending', id: { not: 'req-stage2' } },
      }),
    );
    expect(arUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['req-stage3'] } },
      data: { status: 'withdrawn' },
    });
    // pre_status reflects the sibling's actual prior status ('pending',
    // ordinal 0), read off the row rather than hardcoded -- the exact bug
    // this task's acceptance criteria required fixing.
    expect(historyCreateMany).toHaveBeenCalledWith({
      data: [{
        approval_request_id: 'req-stage3',
        pre_status: 0,
        post_status: 4,
        message: null,
        creator_id: 'user-1',
      }],
    });
  });

  it('also auto-cancels siblings on a terminal rejection', async () => {
    stubRejectingStage2(true);
    txArFindMany.mockResolvedValue([{ id: 'req-stage3', status: 'pending' }]);

    await rejectApprovalRequest('req-stage2');

    expect(arUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['req-stage3'] } },
      data: { status: 'withdrawn' },
    });
    expect(historyCreateMany).toHaveBeenCalledWith({
      data: [{
        approval_request_id: 'req-stage3',
        pre_status: 0,
        post_status: 4,
        message: null,
        creator_id: 'user-1',
      }],
    });
  });

  it('does nothing extra when there are no sibling pending rows', async () => {
    stubRejectingStage2(false);
    txArFindMany.mockResolvedValue([]);

    await rejectApprovalRequest('req-stage2');

    expect(arUpdateMany).not.toHaveBeenCalled();
    expect(historyCreateMany).not.toHaveBeenCalled();
  });
});

// cmd_825/cmd_844: the requestor withdraws their own round's still-pending
// request(s). Permission is "you are approvable.creator_id" (the
// requestor), never approval_flow.approver_role_id membership. cmd_844
// changed the entry point from a single approval_request id to the
// approvable id, and withdrawal from a single-row update to a round-scoped
// updateMany over every still-pending row of the current round.
describe('withdrawApprovalRequest (cmd_825/cmd_844)', () => {
  const stubOwnedByRequestor = () => {
    approvableFindUniqueOuter.mockResolvedValue({ creator_id: 'user-1' });
    findFirst.mockResolvedValue({ round_id: 'round-1' });
  };

  it('closes every pending row of the current round, leaving approved rows untouched', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
      { id: 'req-3', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });

    await withdrawApprovalRequest('appr-1', 'changed my mind');

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { approvable_id: 'appr-1' },
      orderBy: { created_at: 'desc' },
    }));
    expect(txArFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { approvable_id: 'appr-1', round_id: 'round-1', status: 'pending' },
    }));
    expect(arUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['req-2', 'req-3'] } },
      data: { status: 'withdrawn' },
    });
    expect(historyCreateMany).toHaveBeenCalledWith({
      data: [
        { approval_request_id: 'req-2', pre_status: 0, post_status: 4, message: 'changed my mind', creator_id: 'user-1' },
        { approval_request_id: 'req-3', pre_status: 0, post_status: 4, message: 'changed my mind', creator_id: 'user-1' },
      ],
    });
  });

  // cmd_841: withdrawal now dispatches on_withdrawn side effects (e.g. an
  // entity's own status field falling back to a user-selectable value),
  // symmetric to approve/reject's dispatchOnApproved/dispatchOnRejected.
  it('dispatches onWithdrawn with the resolved model and approvable id', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });

    await withdrawApprovalRequest('appr-1');

    expect(dispatchOnWithdrawn).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1');
  });

  // cmd_923b: pre-withdrawal dispatch, called before any write in the same
  // transaction -- a throw rejects the withdrawal entirely.
  it('dispatches beforeWithdraw before the status write', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });

    await withdrawApprovalRequest('appr-1');

    expect(dispatchBeforeWithdraw).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1', 'user-1');
  });

  it('rolls back the withdrawal when beforeWithdraw throws', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    dispatchBeforeWithdraw.mockRejectedValueOnce(new Error('blocked by custom rule'));

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow('blocked by custom rule');

    expect(arUpdateMany).not.toHaveBeenCalled();
    expect(dispatchOnWithdrawn).not.toHaveBeenCalled();
  });

  it('resolves dispatchOnWithdrawn against the model, not the view key', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request_gate' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request_gate' },
      approvable: { creator_id: 'user-1' },
    });
    resolveApprovableModel.mockImplementation((name: string) =>
      name === 'leave_request_gate' ? 'leave_request' : name);

    await withdrawApprovalRequest('appr-1');

    expect(dispatchOnWithdrawn).toHaveBeenCalledWith(expect.anything(), 'leave_request', 'appr-1');
  });

  // cmd_865: an entity_name that resolves to no model at all is treated the
  // same as one that resolves to a model without on_withdrawn declared --
  // there is no model to look up in ENTITIES_WITH_ON_WITHDRAWN, so
  // withdrawal is blocked rather than silently closing the round with no
  // dispatch (the pre-cmd_865 behavior this test used to assert).
  it('rejects and does not close the round when the view key does not resolve to a model', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'unknown_view' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'unknown_view' },
      approvable: { creator_id: 'user-1' },
    });
    resolveApprovableModel.mockReturnValue(null);

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow(
      'Withdrawal is not supported for this entity type (on_withdrawn not declared): unknown_view',
    );
    expect(arUpdateMany).not.toHaveBeenCalled();
    expect(dispatchOnWithdrawn).not.toHaveBeenCalled();
  });

  // cmd_865: the withdraw lockout itself -- an entity whose model resolves
  // fine but does not declare x-approval.on_withdrawn (hasOnWithdrawn false)
  // must not be allowed to withdraw at all (see subtask_865a's
  // ko_withdraw_lockout_design harm_cases).
  it('rejects and does not close the round when the model does not declare on_withdrawn', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'no_withdraw_entity' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'no_withdraw_entity' },
      approvable: { creator_id: 'user-1' },
    });
    hasOnWithdrawn.mockReturnValue(false);

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow(
      'Withdrawal is not supported for this entity type (on_withdrawn not declared): no_withdraw_entity',
    );
    expect(arUpdateMany).not.toHaveBeenCalled();
    expect(historyCreateMany).not.toHaveBeenCalled();
    expect(dispatchOnWithdrawn).not.toHaveBeenCalled();
  });

  it('rejects when the caller is not the requestor', async () => {
    approvableFindUniqueOuter.mockResolvedValue({ creator_id: 'someone-else' });

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow(
      'Access denied: only the requestor may withdraw their own request',
    );
    expect(arUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects when the approvable does not exist', async () => {
    approvableFindUniqueOuter.mockResolvedValue(null);

    await expect(withdrawApprovalRequest('appr-missing')).rejects.toThrow('Approvable not found');
    expect(arUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects when no approval_request round exists yet', async () => {
    approvableFindUniqueOuter.mockResolvedValue({ creator_id: 'user-1' });
    findFirst.mockResolvedValue(null);

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow('No approval request found');
    expect(arUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects when the current round has nothing pending left (e.g. fully approved)', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([]);

    await expect(withdrawApprovalRequest('appr-1')).rejects.toThrow('No pending requests to withdraw');
    expect(arUpdateMany).not.toHaveBeenCalled();
  });

  it('leaves an already-approved sibling row untouched (PD-1: round_id scoping alone, no rewrite)', async () => {
    stubOwnedByRequestor();
    // Only the still-pending row is fetched/closed -- an approved sibling
    // in the same round is never part of this query at all, matching the
    // final PD-1 ruling (round_id scoping alone; approved rows are never
    // rewritten).
    txArFindMany.mockResolvedValue([
      { id: 'req-3', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });

    await withdrawApprovalRequest('appr-1');

    expect(arUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['req-3'] } },
      data: { status: 'withdrawn' },
    });
  });

  it('revalidates the target entity view + edit pages', async () => {
    stubOwnedByRequestor();
    txArFindMany.mockResolvedValue([
      { id: 'req-2', status: 'pending', approval_flow: { entity_name: 'leave_request' } },
    ]);
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });

    await withdrawApprovalRequest('appr-1');

    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/view/lr-42', 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/edit/lr-42', 'page');
  });
});
