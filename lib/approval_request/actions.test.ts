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
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  arUpdate: vi.fn(),
  historyCreate: vi.fn(),
  approvableFindUnique: vi.fn(),
  approvableUpdate: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    approval_request: { findUnique, update: arUpdate },
    $transaction: transactionMock,
  },
}));
vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow: vi.fn(), getUserRoleIds: vi.fn() }));
vi.mock('@/lib/_notifier', () => ({ notify: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
// cmd_540: assertApprovalOrder() (lib/approval_request/order-check.ts) queries
// prisma.approval_request.findMany() directly, which this file's minimal
// prisma mock (above) doesn't define — mocked to a no-op here since order
// enforcement itself is covered by test/flows/approval_order_bypass.test.ts
// (real DB) and this file's own focus (recipient/revalidate targeting) is
// orthogonal to it.
vi.mock('@/lib/approval_request/order-check', () => ({ assertApprovalOrder: vi.fn().mockResolvedValue(undefined) }));

import { getSessionUserIdOrThrow, getUserRoleIds } from '@/lib/authz';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';
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
  approval_request: { update: arUpdate, findUnique },
  approval_history: { create: historyCreate },
  approvable: { findUnique: approvableFindUnique, update: approvableUpdate },
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
  vi.mocked(assertApprovalOrder).mockReset().mockResolvedValue(undefined);
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
