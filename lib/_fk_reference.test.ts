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

import { assertFkReferencesUsable, assertStoredFkReferencesReachable } from './_fk_reference';

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
    // The stored row (item-0) is reachable; the new one (item-1) is in another organization.
    const load = vi.fn((id: string) =>
      Promise.resolve(id === 'item-0' ? { organization_id: 'org-1' } : { organization_id: 'org-2' }),
    );
    await expect(
      assertFkReferencesUsable('u1', [ref(null, { previousId: 'item-0', load })]),
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

describe('references the actor cannot reach (leaving and deleting)', () => {
  const unreachable = { organization_id: 'org-2' };
  const loadByPrevious = (rows: Record<string, Record<string, unknown> | null>) =>
    vi.fn((id: string) => Promise.resolve(rows[id] ?? null));

  it('refuses to re-point a reference away from an unreachable row as PERMISSION_DENIED', async () => {
    const load = loadByPrevious({ 'item-0': unreachable, 'item-1': { organization_id: 'org-1' } });
    await expect(
      assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1' }, { previousId: 'item-0', load })]),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses to clear an optional reference to an unreachable row', async () => {
    const load = loadByPrevious({ 'item-0': unreachable });
    await expect(
      assertFkReferencesUsable('u1', [ref(null, { id: null, previousId: 'item-0', load })]),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('does not treat an empty value on a required column as clearing (the service keeps the stored value)', async () => {
    const load = loadByPrevious({ 'item-0': unreachable });
    await expect(
      assertFkReferencesUsable('u1', [ref(null, { id: null, previousId: 'item-0', required: true, load })]),
    ).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('accepts re-pointing away from a reachable row', async () => {
    const load = loadByPrevious({ 'item-0': { organization_id: 'org-1' }, 'item-1': { organization_id: 'org-1' } });
    await expect(
      assertFkReferencesUsable('u1', [ref({ organization_id: 'org-1' }, { previousId: 'item-0', load })]),
    ).resolves.toBeUndefined();
  });

  it('does not look at the stored row when the value is sent back unchanged', async () => {
    const load = vi.fn();
    await expect(
      assertFkReferencesUsable('u1', [ref(null, { id: 'item-0', previousId: 'item-0', load })]),
    ).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses a delete while a stored reference points at an unreachable row', async () => {
    const load = loadByPrevious({ 'item-0': unreachable });
    await expect(
      assertStoredFkReferencesReachable('u1', [{ model: 'item', id: 'item-0', load }]),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses a delete when the stored target is x-self-only and owned by someone else', async () => {
    const load = loadByPrevious({ 'item-0': { organization_id: 'org-1', creator_id: 'u2' } });
    await expect(
      assertStoredFkReferencesReachable('u1', [{ model: 'item', selfOnly: true, id: 'item-0', load }]),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('allows a delete when every stored reference is reachable, empty, or dangling', async () => {
    const load = loadByPrevious({ 'item-0': { organization_id: 'org-1' } });
    await expect(
      assertStoredFkReferencesReachable('u1', [
        { model: 'item', id: 'item-0', load },
        { model: 'item', id: null, load },
        { model: 'item', id: 'gone', load },
      ]),
    ).resolves.toBeUndefined();
  });
});
