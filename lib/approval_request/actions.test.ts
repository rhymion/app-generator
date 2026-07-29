import { describe, it, expect, beforeEach, vi } from 'vitest';

// cmd_479: getApprovalRequestRecipient() builds the Trigger #3
// (approval_responded) notification href generically via
// resolveApprovableTarget(entityName, approvableId) — it must never fall
// back to `/approval_request/view/{id}`, which has no detail page.

const { findUnique, resolveApprovableTarget } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  resolveApprovableTarget: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { approval_request: { findUnique } },
}));
vi.mock('@/lib/approval_request/resolve_target', () => ({ resolveApprovableTarget }));
vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow: vi.fn(), getUserRoleIds: vi.fn() }));
vi.mock('@/lib/_notifier', () => ({ notify: vi.fn() }));
vi.mock('@/lib/approval_request/on_approved_dispatch', () => ({ dispatchOnApproved: vi.fn() }));
vi.mock('@/lib/approval_request/on_rejected_dispatch', () => ({
  isTerminalReject: vi.fn(() => false),
  dispatchOnRejected: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getApprovalRequestRecipient } from './actions';

beforeEach(() => {
  findUnique.mockReset();
  resolveApprovableTarget.mockReset();
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
    expect(result).toEqual({ recipientId: null, entityName: 'leave_request', href: undefined });
  });
});
