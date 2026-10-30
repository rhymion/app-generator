import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getOrgs, canAccess } = vi.hoisted(() => ({
  getOrgs: vi.fn(),
  canAccess: vi.fn(),
}));

vi.mock('@/lib/organization/associated_internal', () => ({ getAssociatedOrganizations: getOrgs }));
vi.mock('@/lib/authz', () => ({ canAccess }));

import { assertFkReferencesUsable } from './_fk_reference';

const ref = (row: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  model: 'item',
  id: 'item-1',
  load: vi.fn().mockResolvedValue(row),
  ...extra,
});

beforeEach(() => {
  getOrgs.mockReset();
  canAccess.mockReset();
  getOrgs.mockResolvedValue([{ id: 'org-1' }]);
  canAccess.mockResolvedValue(true);
});

describe('assertFkReferencesUsable', () => {
  it('accepts a row in the actor organization that the actor can read', async () => {
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1' })])).resolves.toBeUndefined();
    expect(canAccess).toHaveBeenCalledWith('item', 'read', 'u1', { creator_id: null, assignee_id: null });
  });

  it('refuses a row in an organization the actor does not belong to as NOT_FOUND', async () => {
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: 'org-2' })])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(canAccess).not.toHaveBeenCalled();
  });

  it('refuses a same-organization row the actor cannot read as NOT_FOUND', async () => {
    canAccess.mockResolvedValue(false);
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1' })])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a missing row as NOT_FOUND', async () => {
    await expect(assertFkReferencesUsable('u1', [ref(null)])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts a row without an organization when the actor can read it', async () => {
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: null })])).resolves.toBeUndefined();
  });

  it('passes creator and assignee to the read check', async () => {
    await assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1', creator_id: 'u1', assignee_id: 'u2' })]);
    expect(canAccess).toHaveBeenCalledWith('item', 'read', 'u1', { creator_id: 'u1', assignee_id: 'u2' });
  });

  it('does not load anything for empty or unchanged references', async () => {
    const empty = ref(null, { id: null });
    const unchanged = ref(null, { previousId: 'item-1' });
    await assertFkReferencesUsable('u1', [empty, unchanged]);
    expect(empty.load).not.toHaveBeenCalled();
    expect(unchanged.load).not.toHaveBeenCalled();
    expect(getOrgs).not.toHaveBeenCalled();
  });

  it('checks a reference that changed', async () => {
    await expect(
      assertFkReferencesUsable('u1', [ref({ organization_id: 'org-2' }, { previousId: 'item-0' })]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
