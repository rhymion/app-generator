import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindMany } = vi.hoisted(() => ({ userFindMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { user: { findMany: userFindMany } } }));

import { filterMentionRecipientsToRecordOrg } from './recipients';

beforeEach(() => {
  userFindMany.mockReset();
});

describe('filterMentionRecipientsToRecordOrg', () => {
  it('does not scope a record without an organization: every candidate is kept, in order, with no query', async () => {
    for (const noOrg of [null, undefined, '']) {
      expect(await filterMentionRecipientsToRecordOrg(noOrg, ['u2', 'u1', 'u3'])).toEqual(['u2', 'u1', 'u3']);
    }
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('keeps only members of the record\'s organization, in the original order', async () => {
    userFindMany.mockResolvedValue([{ id: 'u3' }, { id: 'u1' }]);

    const kept = await filterMentionRecipientsToRecordOrg('org-a', ['u1', 'u2', 'u3']);

    expect(kept).toEqual(['u1', 'u3']);
    // the scope is the record's organization itself, not any organization of the commenter
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2', 'u3'] }, organizations: { some: { id: 'org-a' } } },
      select: { id: true },
    });
  });

  it('keeps nobody when no candidate belongs to the record\'s organization', async () => {
    userFindMany.mockResolvedValue([]);
    expect(await filterMentionRecipientsToRecordOrg('org-a', ['u1'])).toEqual([]);
  });

  it('returns an empty list for no candidates without a query', async () => {
    expect(await filterMentionRecipientsToRecordOrg('org-a', [])).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
