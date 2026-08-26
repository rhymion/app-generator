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

const {
  findUnique, arUpdate, historyCreate, approvableFindUnique, approvableUpdate, transactionMock, revalidatePathMock,
  txFlowFindUnique, txArFindMany, prismaArFindMany, prismaRoleFindUnique,
  notifyMock, notifyApprovalRequestCreatedMock,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  arUpdate: vi.fn(),
  historyCreate: vi.fn(),
  approvableFindUnique: vi.fn(),
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

const {
  getApprovalRequestRecipient, approveApprovalRequest, rejectApprovalRequest, withdrawApprovalRequest,
} = createApprovalActions({
  resolveApprovableTarget,
  resolveApprovableModel,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
});

// Fake tx client shared by every prisma.$transaction(cb) call in
// approve/reject — cb receives this in place of a real transaction.
const fakeTx = {
  approval_request: { update: arUpdate, findUnique, findMany: txArFindMany },
  approval_history: { create: historyCreate },
  approvable: { findUnique: approvableFindUnique, update: approvableUpdate },
  approval_flow: { findUnique: txFlowFindUnique },
};

beforeEach(() => {
  findUnique.mockReset();
  arUpdate.mockReset();
  historyCreate.mockReset();
  approvableFindUnique.mockReset();
  approvableUpdate.mockReset();
  revalidatePathMock.mockReset();
  resolveApprovableTarget.mockReset();
  resolveApprovableModel.mockReset().mockImplementation((name: string) => name);
  dispatchOnApproved.mockReset();
  dispatchOnRejected.mockReset();
  isTerminalReject.mockReset().mockReturnValue(false);
  transactionMock.mockReset().mockImplementation(async (cb) => cb(fakeTx));
  vi.mocked(getSessionUserIdOrThrow).mockReset().mockResolvedValue('user-1');
  vi.mocked(getUserRoleIds).mockReset().mockResolvedValue(['approver-role']);
  // Default: no follow-on flows for the just-approved flow, so existing
  // tests that don't care about cmd_541's order-reached notification see no
  // behavior change (findNewlyActionableFollowFlowIds() short-circuits on
  // an empty `followed_by`).
  txFlowFindUnique.mockReset().mockResolvedValue({ followed_by: [] });
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
  // in-transaction lookup used to decide terminal vs non-terminal, (3)
  // getApprovalRequestRecipient() after the transaction commits. Each call
  // only needs a subset of fields, but all three must resolve for the
  // whole flow to complete without throwing.
  const stubRejectLookups = () => {
    findUnique.mockReset();
    findUnique
      .mockResolvedValueOnce({ approval_flow: { approver_role_id: 'approver-role' } })
      .mockResolvedValueOnce({ approval_flow: { entity_name: 'leave_request' } })
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
      approval_flow: { entity_name: 'leave_request' },
    });
    approvableFindUnique.mockResolvedValue({
      id: 'appr-1',
      approved_at: new Date(),
      approval_requests: [{ status: 'approved' }],
    });

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
      status: 'pending',
      approval_flow: { approver_role_id: 'approver-role', entity_name: 'user' },
      approvable: { creator_id: 'requester-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'user' },
    });
    approvableFindUnique.mockResolvedValue({
      id: 'appr-1',
      approved_at: null,
      approval_requests: [{ status: 'approved' }, { status: 'pending' }],
    });
    resolveApprovableTarget.mockResolvedValue({ id: 'user-99' });
  }

  it('notifies the newly-actionable follow-on flow\'s approver role', async () => {
    stubApprovingFlow1();
    // flow-2 is preceded_by only flow-1 (the one just approved), and
    // flow-1's sibling approval_request is already 'approved' — so flow-2
    // just became fully unblocked.
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
    // Default beforeEach mocks: followed_by: [] — nothing depends on flow-1.

    await approveApprovalRequest('req-1');

    expect(vi.mocked(notify).mock.calls.filter((c) => c[1] === 'approval_order_reached')).toHaveLength(0);
  });

  it('does not re-notify when the request was already approved (idempotency guard)', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
      approval_flow_id: 'flow-1',
      status: 'approved', // already approved before this call
      approval_flow: { approver_role_id: 'approver-role', entity_name: 'user' },
      approvable: { creator_id: 'requester-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'user' },
    });
    approvableFindUnique.mockResolvedValue({
      id: 'appr-1',
      approved_at: new Date(),
      approval_requests: [{ status: 'approved' }, { status: 'approved' }],
    });
    // Even if a follow-on flow would otherwise look unblocked, the
    // before.status !== 'approved' guard must skip the lookup entirely.
    txFlowFindUnique.mockResolvedValue({ followed_by: [{ id: 'flow-2', preceded_by: [{ id: 'flow-1' }] }] });
    txArFindMany.mockResolvedValue([{ approval_flow_id: 'flow-1', status: 'approved' }]);

    await approveApprovalRequest('req-1');

    expect(txFlowFindUnique).not.toHaveBeenCalled();
    expect(vi.mocked(notify).mock.calls.filter((c) => c[1] === 'approval_order_reached')).toHaveLength(0);
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
      approval_flow: { entity_name: 'purchase_request_gate', approver_role_id: 'approver-role' },
      approvable: { creator_id: 'creator-1' },
    });
    arUpdate.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'purchase_request_gate' },
    });
    approvableFindUnique.mockResolvedValue({
      id: 'appr-1',
      approved_at: null,
      approval_requests: [{ status: 'approved' }],
    });
    resolveApprovableModel.mockImplementation((name: string) =>
      name === 'purchase_request_gate' ? 'purchase_request' : name);
    resolveApprovableTarget.mockResolvedValue({ id: 'pr-1' });

    await approveApprovalRequest('req-1');

    expect(dispatchOnApproved).toHaveBeenCalledWith(expect.anything(), 'purchase_request', 'appr-1', 'user-1');
  });

  it('rejectApprovalRequest resolves isTerminalReject/dispatchOnRejected against the model, not the view key', async () => {
    findUnique.mockResolvedValue({
      approvable_id: 'appr-1',
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

// cmd_825: the requestor withdraws their own still-pending request.
// Permission is "you are approvable.creator_id" (the requestor), never
// approval_flow.approver_role_id membership -- and only from 'pending'.
describe('withdrawApprovalRequest (cmd_825)', () => {
  const stubPendingOwnedByRequestor = () => {
    findUnique.mockResolvedValue({
      status: 'pending',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });
  };

  it('transitions status to withdrawn and records history', async () => {
    stubPendingOwnedByRequestor();
    arUpdate.mockResolvedValue({ id: 'req-1' });

    await withdrawApprovalRequest('req-1', 'changed my mind');

    expect(arUpdate).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'withdrawn' },
      select: { id: true },
    });
    expect(historyCreate).toHaveBeenCalledWith({
      data: {
        approval_request_id: 'req-1',
        pre_status: 0,
        post_status: 4,
        message: 'changed my mind',
        creator_id: 'user-1',
      },
    });
  });

  it('rejects when the caller is not the requestor', async () => {
    findUnique.mockResolvedValue({
      status: 'pending',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'someone-else' },
    });

    await expect(withdrawApprovalRequest('req-1')).rejects.toThrow(
      'Access denied: only the requestor may withdraw their own request',
    );
    expect(arUpdate).not.toHaveBeenCalled();
  });

  it('rejects when the request is not pending', async () => {
    findUnique.mockResolvedValue({
      status: 'approved',
      approvable_id: 'appr-1',
      approval_flow: { entity_name: 'leave_request' },
      approvable: { creator_id: 'user-1' },
    });

    await expect(withdrawApprovalRequest('req-1')).rejects.toThrow(
      'Only a pending approval request can be withdrawn',
    );
    expect(arUpdate).not.toHaveBeenCalled();
  });

  it('rejects when the approval request does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(withdrawApprovalRequest('req-missing')).rejects.toThrow('Approval request not found');
    expect(arUpdate).not.toHaveBeenCalled();
  });

  it('revalidates the target entity view + edit pages', async () => {
    stubPendingOwnedByRequestor();
    arUpdate.mockResolvedValue({ id: 'req-1' });
    resolveApprovableTarget.mockResolvedValue({ id: 'lr-42' });

    await withdrawApprovalRequest('req-1');

    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/view/lr-42', 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]/leave_request/edit/lr-42', 'page');
  });
});
