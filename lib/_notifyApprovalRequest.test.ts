import { describe, it, expect, beforeEach, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@/lib/_notifier', () => ({ notify }));

import { notifyApprovalRequestCreated, notifyApprovalOrderReached } from './_notifyApprovalRequest';

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

// cmd_541: same shape as makeTx() above, but for notifyApprovalOrderReached()
// — findMany (one row per flowId) instead of findUnique, and a per-request
// role lookup keyed by that request's own approval_flow.approver_role_id
// (roleUsersByRoleId), since each follow-on flow can have a different
// approver role.
function makeOrderReachedDb({
  requests,
  roleUsersByRoleId,
}: {
  requests: Array<{ id: string; approval_flow: { approver_role_id: string | null; entity_name: string } | null }>;
  roleUsersByRoleId: Record<string, Array<{ id: string }>>;
}) {
  return {
    approval_request: {
      findMany: vi.fn().mockResolvedValue(requests),
    },
    role: {
      findUnique: vi.fn().mockImplementation(({ where: { id } }: { where: { id: string } }) => {
        const users = roleUsersByRoleId[id];
        return Promise.resolve(users ? { users } : null);
      }),
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

  // cmd_479: the notification must link to the approvable's own detail page
  // (`/{targetEntityName}/view/{targetId}`), not `/approval_request/view/{id}`
  // — that route never existed (approval_request has no detail page).
  describe('href (cmd_479)', () => {
    it('links to the target entity detail page when targetEntityName/targetId are given', async () => {
      const tx = makeTx({
        approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
        roleUsers: [{ id: 'u1', organizations: [] }],
      });

      await notifyApprovalRequestCreated(tx, 'req-1', {
        targetEntityName: 'leave_request',
        targetId: 'lr-42',
      });

      expect(notify.mock.calls[0][2]).toMatchObject({ href: '/leave_request/view/lr-42' });
    });

    it('never links to /approval_request/view/ regardless of target presence', async () => {
      const tx = makeTx({
        approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
        roleUsers: [{ id: 'u1', organizations: [] }],
      });

      await notifyApprovalRequestCreated(tx, 'req-1', {
        targetEntityName: 'leave_request',
        targetId: 'lr-42',
      });

      const href = notify.mock.calls[0][2].href as string;
      expect(href).not.toMatch(/^\/approval_request\/view\//);
    });

    it('omits href (does not fall back to the approval_request row) when target is unknown', async () => {
      const tx = makeTx({
        approvalFlow: { approver_role_id: 'role-1', entity_name: 'leave_request' },
        roleUsers: [{ id: 'u1', organizations: [] }],
      });

      await notifyApprovalRequestCreated(tx, 'req-1');

      expect(notify.mock.calls[0][2].href).toBeUndefined();
    });
  });
});

// cmd_541: when a preceding flow in a preceded_by chain is approved and
// unblocks one or more follow-on flows, notify every user holding each of
// those flows' approver role — distinct from notifyApprovalRequestCreated
// above, which already notified these same users once at creation time,
// before they could act.
describe('notifyApprovalOrderReached', () => {
  it('notifies every user holding each newly-actionable flow\'s approver role', async () => {
    const db = makeOrderReachedDb({
      requests: [
        { id: 'req-2', approval_flow: { approver_role_id: 'role-2', entity_name: 'leave_request' } },
      ],
      roleUsersByRoleId: { 'role-2': [{ id: 'u1' }, { id: 'u2' }] },
    });

    await notifyApprovalOrderReached(db, 'appr-1', ['flow-2']);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
    expect(notify.mock.calls[0][1]).toBe('approval_order_reached');
    expect(notify.mock.calls[0][2]).toMatchObject({ approvalRequestId: 'req-2', entityName: 'leave_request' });
  });

  it('is a no-op when flowIds is empty (no DB call at all)', async () => {
    const db = makeOrderReachedDb({ requests: [], roleUsersByRoleId: {} });

    await notifyApprovalOrderReached(db, 'appr-1', []);

    expect(db.approval_request.findMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('excludes excludeUserId from the recipient list', async () => {
    const db = makeOrderReachedDb({
      requests: [
        { id: 'req-2', approval_flow: { approver_role_id: 'role-2', entity_name: 'leave_request' } },
      ],
      roleUsersByRoleId: { 'role-2': [{ id: 'u1' }, { id: 'u2' }] },
    });

    await notifyApprovalOrderReached(db, 'appr-1', ['flow-2'], { excludeUserId: 'u1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('u2');
  });

  it('notifies each of multiple newly-actionable flows independently', async () => {
    const db = makeOrderReachedDb({
      requests: [
        { id: 'req-2', approval_flow: { approver_role_id: 'role-2', entity_name: 'leave_request' } },
        { id: 'req-3', approval_flow: { approver_role_id: 'role-3', entity_name: 'leave_request' } },
      ],
      roleUsersByRoleId: { 'role-2': [{ id: 'u2' }], 'role-3': [{ id: 'u3' }] },
    });

    await notifyApprovalOrderReached(db, 'appr-1', ['flow-2', 'flow-3']);

    expect(notify.mock.calls.map((c) => c[0])).toEqual(['u2', 'u3']);
  });

  it('links to the target entity detail page when targetEntityName/targetId are given', async () => {
    const db = makeOrderReachedDb({
      requests: [
        { id: 'req-2', approval_flow: { approver_role_id: 'role-2', entity_name: 'leave_request' } },
      ],
      roleUsersByRoleId: { 'role-2': [{ id: 'u1' }] },
    });

    await notifyApprovalOrderReached(db, 'appr-1', ['flow-2'], {
      targetEntityName: 'leave_request',
      targetId: 'lr-42',
    });

    expect(notify.mock.calls[0][2]).toMatchObject({ href: '/leave_request/view/lr-42' });
  });

  it('is a no-op for a flow with no approver_role_id', async () => {
    const db = makeOrderReachedDb({
      requests: [{ id: 'req-2', approval_flow: { approver_role_id: null, entity_name: 'leave_request' } }],
      roleUsersByRoleId: {},
    });

    await notifyApprovalOrderReached(db, 'appr-1', ['flow-2']);

    expect(notify).not.toHaveBeenCalled();
  });
});
