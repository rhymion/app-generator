import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindMany, getModelPermissions, resolveMentionRecordOrganization } = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  getModelPermissions: vi.fn(),
  resolveMentionRecordOrganization: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findMany: userFindMany } } }));
vi.mock('@/lib/authz', () => ({
  getSessionUserIdOrThrow: vi.fn().mockResolvedValue('actor'),
  getModelPermissions,
}));
// Generated per schema (gitignored): what matters is the organization it resolves for the record.
vi.mock('@/lib/mention/record_org', () => ({ resolveMentionRecordOrganization }));

import { searchMentionUserOptions } from './search';

const ALICE = { id: 'u1', name: 'Alice', email: 'alice@example.com' };

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([ALICE]);
  getModelPermissions.mockReset().mockResolvedValue({ permissions: { read: true } });
  resolveMentionRecordOrganization.mockReset();
});

describe('searchMentionUserOptions', () => {
  it('a record without an organization does not scope the candidates (the actor needs no organization)', async () => {
    resolveMentionRecordOrganization.mockResolvedValue({ organizationId: null });

    const result = await searchMentionUserOptions('al', { entity: 'ticket', id: 'rec-1' });

    expect(result).toEqual({ options: [ALICE], permissionDenied: false });
    expect(resolveMentionRecordOrganization).toHaveBeenCalledWith('ticket', 'rec-1', 'actor');
    const where = userFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('organizations');
    expect(where).toMatchObject({ name: { contains: 'al' } });
  });

  it('a record with an organization offers only that organization\'s members', async () => {
    resolveMentionRecordOrganization.mockResolvedValue({ organizationId: 'org-a' });

    await searchMentionUserOptions('', { entity: 'ticket', id: 'rec-1' });

    expect(userFindMany.mock.calls[0][0].where).toEqual({ organizations: { some: { id: 'org-a' } } });
  });

  it('a record that is unknown, missing or unreadable yields no candidates and no query', async () => {
    resolveMentionRecordOrganization.mockResolvedValue(null);

    const result = await searchMentionUserOptions('al', { entity: 'ticket', id: 'other-orgs-record' });

    expect(result).toEqual({ options: [], permissionDenied: false });
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('without a record (a form for a record that is not saved yet) nothing is scoped', async () => {
    await searchMentionUserOptions('al');
    await searchMentionUserOptions('al', null);

    expect(resolveMentionRecordOrganization).not.toHaveBeenCalled();
    for (const call of userFindMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('organizations');
    }
  });

  it('answers permissionDenied before reading any record when the caller cannot read users', async () => {
    getModelPermissions.mockResolvedValue({ permissions: { read: false } });

    const result = await searchMentionUserOptions('al', { entity: 'ticket', id: 'rec-1' });

    expect(result).toEqual({ options: [], permissionDenied: true });
    expect(resolveMentionRecordOrganization).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
