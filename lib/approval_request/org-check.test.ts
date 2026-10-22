import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestFindUnique, orgFindFirst } = vi.hoisted(() => ({
  requestFindUnique: vi.fn(),
  orgFindFirst: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    approval_request: { findUnique: requestFindUnique },
    organization: { findFirst: orgFindFirst },
  },
}));

import { isApproverInTargetOrganization } from './org-check';

const resolve = vi.fn();

beforeEach(() => {
  requestFindUnique.mockReset().mockResolvedValue({ approvable_id: 'ap-1', approval_flow: { entity_name: 'item' } });
  orgFindFirst.mockReset().mockResolvedValue(null);
  resolve.mockReset();
});

describe('isApproverInTargetOrganization', () => {
  it('refuses a user who is not a member of the record organization', async () => {
    resolve.mockResolvedValue({ scoped: true, organizationId: 'org-b' });
    orgFindFirst.mockResolvedValue(null);

    await expect(isApproverInTargetOrganization('user-a', 'req-1', resolve)).resolves.toBe(false);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), 'item', 'ap-1');
    expect(orgFindFirst).toHaveBeenCalledWith({
      where: { id: 'org-b', users: { some: { id: 'user-a' } } },
      select: { id: true },
    });
  });

  it('allows a member of the record organization', async () => {
    resolve.mockResolvedValue({ scoped: true, organizationId: 'org-b' });
    orgFindFirst.mockResolvedValue({ id: 'org-b' });

    await expect(isApproverInTargetOrganization('user-b', 'req-1', resolve)).resolves.toBe(true);
  });

  it('allows an entity that is not organization-scoped', async () => {
    resolve.mockResolvedValue({ scoped: false });

    await expect(isApproverInTargetOrganization('user-a', 'req-1', resolve)).resolves.toBe(true);
    expect(orgFindFirst).not.toHaveBeenCalled();
  });

  it('allows a record with no organization (optional relationship)', async () => {
    resolve.mockResolvedValue({ scoped: true, organizationId: null });

    await expect(isApproverInTargetOrganization('user-a', 'req-1', resolve)).resolves.toBe(true);
    expect(orgFindFirst).not.toHaveBeenCalled();
  });

  it('refuses when the target record or entity cannot be resolved (fail closed)', async () => {
    resolve.mockResolvedValue(null);
    await expect(isApproverInTargetOrganization('user-a', 'req-1', resolve)).resolves.toBe(false);
  });

  it('refuses when the approval request does not exist', async () => {
    requestFindUnique.mockResolvedValue(null);
    await expect(isApproverInTargetOrganization('user-a', 'req-x', resolve)).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });
});
