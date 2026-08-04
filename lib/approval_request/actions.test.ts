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

import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { notify } from '@/lib/_notifier';
import { createApprovalActions } from './actions_core';

const resolveApprovableTarget = vi.fn();
const dispatchOnApproved = vi.fn();
const dispatchOnRejected = vi.fn();
const isTerminalReject = vi.fn(() => false);

const {
  getApprovalRequestRecipient, approveApprovalRequest, rejectApprovalRequest, resubmitApprovalRequest,
} = createApprovalActions({
  resolveApprovableTarget,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
});

// Fake tx client shared by every prisma.$transaction(cb) call in
// approve/reject/resubmit — cb receives this in place of a real transaction.
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
  notifyMock.mockReset();
  notifyApprovalRequestCreatedMock.mockReset();
});

// cmd_539: resubmitApprovalRequest() reuses the existing approval_request
// row (only its status changes back to 'pending') instead of creating a
// new one, so notifyApprovalRequestCreated() — wired only into the
// *creation* path elsewhere — never re-fired for a resubmission, leaving
// approver-role holders untold that the request needs their attention
// again. See cypress/e2e/api/approval_request_resubmit_notification.cy.ts
// for the delivery-level (real DB, real notification row) proof; this test
// pins the call-site contract at the unit level.
describe('resubmitApprovalRequest notifies approvers (cmd_539)', () => {
  it('calls notifyApprovalRequestCreated with the resolved target and excludes the resubmitter', async () => {
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

    await resubmitApprovalRequest('req-1', 'here is the fix');

    expect(notifyApprovalRequestCreatedMock).toHaveBeenCalledWith(expect.anything(), 'req-1', {
      excludeUserId: 'user-1',
      targetEntityName: 'leave_request',
      targetId: 'lr-42',
    });
  });
});

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
// tests pin the fixed behavior: approve/reject/resubmit must revalidate the
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

  it('resubmitApprovalRequest revalidates the target entity view + edit pages', async () => {
    stubApprovalFlowLookup();

    await resubmitApprovalRequest('req-1');

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
        requestor_role_id: 'requestor-role',
      },
      approvable: null,
      status: 'rejected',
    });
    // No approvable bridge (creator_id unresolvable) — permission passes via
    // the requestor-role fallback in assertResubmitPermission instead.
    vi.mocked(getUserRoleIds).mockResolvedValue(['requestor-role']);

    await resubmitApprovalRequest('req-1');

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
