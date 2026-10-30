import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getOrgs, canAccessRecord, canAccessEntity, selfOnlyBypass } = vi.hoisted(() => ({
  getOrgs: vi.fn(),
  canAccessRecord: vi.fn(),
  canAccessEntity: vi.fn(),
  selfOnlyBypass: vi.fn(),
}));

vi.mock('@/lib/organization/getters_associated', () => ({ getAssociatedOrganizations: getOrgs }));
vi.mock('@/lib/authz', () => ({ canAccessRecord, canAccessEntity }));
vi.mock('@/lib/self_only', () => ({ trySelfOnlyAdminBypass: selfOnlyBypass }));

import { assertFkReferencesUsable } from './_fk_reference';

const ref = (row: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  model: 'item',
  id: 'item-1',
  load: vi.fn().mockResolvedValue(row),
  ...extra,
});

beforeEach(() => {
  getOrgs.mockReset();
  canAccessRecord.mockReset();
  canAccessEntity.mockReset();
  selfOnlyBypass.mockReset();
  getOrgs.mockResolvedValue([{ id: 'org-1' }]);
  canAccessRecord.mockResolvedValue(true);
  canAccessEntity.mockResolvedValue(true);
  selfOnlyBypass.mockResolvedValue(false);
});

describe('assertFkReferencesUsable', () => {
  it('accepts a row in the actor organization that the actor can read', async () => {
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1' })])).resolves.toBeUndefined();
    expect(canAccessRecord).toHaveBeenCalledWith('item', 'read', { creator_id: null, assignee_id: null }, 'u1');
  });

  it('refuses a row in an organization the actor does not belong to as NOT_FOUND', async () => {
    await expect(assertFkReferencesUsable('u1', [ref({ organization_id: 'org-2' })])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(canAccessRecord).not.toHaveBeenCalled();
  });

  it('refuses a same-organization row the actor cannot read as NOT_FOUND', async () => {
    canAccessRecord.mockResolvedValue(false);
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
    expect(canAccessRecord).toHaveBeenCalledWith('item', 'read', { creator_id: 'u1', assignee_id: 'u2' }, 'u1');
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

  describe('x-self-only target', () => {
    const selfOnly = (row: Record<string, unknown> | null) => ref(row, { selfOnly: true });

    it('accepts a row the actor created', async () => {
      await expect(assertFkReferencesUsable('u1', [selfOnly({ organization_id: 'org-1', creator_id: 'u1' })])).resolves.toBeUndefined();
      expect(canAccessEntity).toHaveBeenCalledWith('item', 'read', 'u1');
      expect(canAccessRecord).not.toHaveBeenCalled();
    });

    it("refuses another user's row as NOT_FOUND even when the actor holds a general read grant", async () => {
      canAccessRecord.mockResolvedValue(true);
      await expect(assertFkReferencesUsable('u1', [selfOnly({ organization_id: 'org-1', creator_id: 'u2' })])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("accepts another user's row only through the audited admin bypass", async () => {
      selfOnlyBypass.mockResolvedValue(true);
      await expect(assertFkReferencesUsable('u1', [selfOnly({ organization_id: 'org-1', creator_id: 'u2' })])).resolves.toBeUndefined();
      expect(selfOnlyBypass).toHaveBeenCalledWith('item', 'u1');
    });

    it('refuses the actor\'s own row when the actor has no read permission on the entity', async () => {
      canAccessEntity.mockResolvedValue(false);
      await expect(assertFkReferencesUsable('u1', [selfOnly({ organization_id: 'org-1', creator_id: 'u1' })])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
