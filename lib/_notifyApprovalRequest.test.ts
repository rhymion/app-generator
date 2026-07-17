import { describe, it, expect, beforeEach, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@/lib/_notifier', () => ({ notify }));

import { notifyApprovalRequestCreated } from './_notifyApprovalRequest';

function makeTx({
  approvalFlow,
  roleUsers,
}: {
  approvalFlow: { approver_role_id: string | null; entity_name: string } | null;
  roleUsers?: Array<{ id: string; organizations: Array<{ id: string }> }>;
}) {
  return {
    approval_request: {
      findUnique: vi.fn().mockResolvedValue(
        approvalFlow
          ? { id: 'req-1', approval_flow: approvalFlow }
          : { id: 'req-1', approval_flow: null },
      ),
    },
    role: {
      findUnique: vi.fn().mockResolvedValue(
        roleUsers !== undefined ? { users: roleUsers } : null,
      ),
    },
  };
}

beforeEach(() => {
  notify.mockReset();
});

describe('notifyApprovalRequestCreated', () => {
  it('notifies every user holding the approver role', async () => {
    const tx = makeTx({
      approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
      roleUsers: [
        { id: 'u1', organizations: [] },
        { id: 'u2', organizations: [] },
      ],
    });

    await notifyApprovalRequestCreated(tx, 'req-1');

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
    expect(notify.mock.calls[0][1]).toBe('approval_requested');
  });

  it('excludes the excludeUserId from the recipient list', async () => {
    const tx = makeTx({
      approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
      roleUsers: [
        { id: 'u1', organizations: [] },
        { id: 'u2', organizations: [] },
      ],
    });

    await notifyApprovalRequestCreated(tx, 'req-1', { excludeUserId: 'u1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('u2');
  });

  it('filters out users not in the given orgId when org-scoped', async () => {
    const tx = makeTx({
      approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
      roleUsers: [
        { id: 'u1', organizations: [{ id: 'org-a' }] },
        { id: 'u2', organizations: [{ id: 'org-b' }] },
      ],
    });

    await notifyApprovalRequestCreated(tx, 'req-1', { orgId: 'org-a' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('u1');
  });

  it('is a no-op when the approval_flow has no approver_role_id (or is absent)', async () => {
    const tx = makeTx({ approvalFlow: { approver_role_id: null, entity_name: 'leave_request' } });

    await notifyApprovalRequestCreated(tx, 'req-1');

    expect(notify).not.toHaveBeenCalled();
  });
});
