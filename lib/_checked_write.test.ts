import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/_errors';

const { requireEntityPermission, requireRecordPermission, getOrgs } = vi.hoisted(() => ({
  requireEntityPermission: vi.fn(),
  requireRecordPermission: vi.fn(),
  getOrgs: vi.fn(),
}));
vi.mock('@/lib/authz', () => ({ requireEntityPermission, requireRecordPermission }));
vi.mock('@/lib/organization/associated_internal', () => ({ getAssociatedOrganizations: getOrgs }));

import { assertCanCreate, assertCanDeleteRecords, assertCanWriteRecord, type CheckedRecordSpec } from './_checked_write';

type Row = { id: string; creator_id: string | null; organization_id: string | null; status?: string };

const ROWS: Row[] = [
  { id: 'mine', creator_id: 'actor', organization_id: 'org-a', status: 'open' },
  { id: 'other-org', creator_id: 'actor', organization_id: 'org-b', status: 'open' },
  { id: 'no-org', creator_id: 'actor', organization_id: null, status: 'open' },
  { id: 'closed', creator_id: 'actor', organization_id: 'org-a', status: 'closed' },
  { id: 'someone-else', creator_id: 'other', organization_id: 'org-a', status: 'open' },
];

// Mirrors the generated load(): a findFirst on id within the actor's organizations.
function spec(over: Partial<CheckedRecordSpec<Row>> = {}): CheckedRecordSpec<Row> {
  const orgScope = over.orgScope ?? 'required';
  return {
    entity: 'thing',
    orgScope,
    selfOnly: false,
    load: vi.fn(async (id: string, orgIds: string[] | null) => {
      const row = ROWS.find((r) => r.id === id) ?? null;
      if (!row || orgIds === null) return row;
      if (row.organization_id === null) return orgScope === 'optional' ? row : null;
      return orgIds.includes(row.organization_id) ? row : null;
    }),
    ...over,
  };
}

function denied(entity: string, op: string) {
  return new AppError('PERMISSION_DENIED', `Access denied: ${entity}.${op}`);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : `other: ${String(e)}`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  requireEntityPermission.mockResolvedValue({});
  requireRecordPermission.mockResolvedValue({});
  getOrgs.mockResolvedValue([{ id: 'org-a' }]);
});

describe('assertCanCreate', () => {
  it('passes with the create permission', async () => {
    await assertCanCreate('thing', 'actor');
    expect(requireEntityPermission).toHaveBeenCalledWith('thing', 'create', 'actor');
  });

  it('is denied (403) without it', async () => {
    requireEntityPermission.mockRejectedValue(denied('thing', 'create'));
    expect(await codeOf(assertCanCreate('thing', 'actor'))).toBe('PERMISSION_DENIED');
  });

  it('is denied without an actor', async () => {
    expect(await codeOf(assertCanCreate('thing', ''))).toBe('PERMISSION_DENIED');
    expect(requireEntityPermission).not.toHaveBeenCalled();
  });
});

describe('assertCanWriteRecord', () => {
  it.each(['update', 'delete'] as const)('returns the record when every check passes (%s)', async (op) => {
    const s = spec();
    expect(await assertCanWriteRecord(s, op, 'actor', 'mine')).toMatchObject({ id: 'mine' });
    expect(requireEntityPermission).toHaveBeenCalledWith('thing', op, 'actor');
    expect(s.load).toHaveBeenCalledWith('mine', ['org-a']);
    expect(requireRecordPermission).toHaveBeenCalledWith('thing', op, expect.objectContaining({ id: 'mine' }), 'actor');
  });

  it('is denied (403) without the entity permission, before the record is read', async () => {
    requireEntityPermission.mockRejectedValue(denied('thing', 'update'));
    const s = spec();
    expect(await codeOf(assertCanWriteRecord(s, 'update', 'actor', 'mine'))).toBe('PERMISSION_DENIED');
    expect(s.load).not.toHaveBeenCalled();
  });

  it('answers 404 for a record of another organization, without a record-level check', async () => {
    expect(await codeOf(assertCanWriteRecord(spec(), 'update', 'actor', 'other-org'))).toBe('NOT_FOUND');
    expect(requireRecordPermission).not.toHaveBeenCalled();
  });

  it('answers 404 for a record that does not exist', async () => {
    expect(await codeOf(assertCanWriteRecord(spec(), 'delete', 'actor', 'missing'))).toBe('NOT_FOUND');
  });

  it('treats a record without an organization as reachable only for an optional organization relation', async () => {
    expect(await codeOf(assertCanWriteRecord(spec(), 'update', 'actor', 'no-org'))).toBe('NOT_FOUND');
    expect(await codeOf(assertCanWriteRecord(spec({ orgScope: 'optional' }), 'update', 'actor', 'no-org'))).toBe('ok');
  });

  it('does not read organizations for an entity without organization scope', async () => {
    const s = spec({ orgScope: 'none' });
    expect(await codeOf(assertCanWriteRecord(s, 'update', 'actor', 'other-org'))).toBe('ok');
    expect(getOrgs).not.toHaveBeenCalled();
    expect(s.load).toHaveBeenCalledWith('other-org', null);
  });

  it('is denied (403) when the record-level permission is missing (Creator grant on a record of someone else)', async () => {
    requireRecordPermission.mockRejectedValue(denied('thing', 'update'));
    expect(await codeOf(assertCanWriteRecord(spec(), 'update', 'actor', 'someone-else'))).toBe('PERMISSION_DENIED');
  });

  it('answers 404 for a record outside the x-filter-values view', async () => {
    const s = spec({ filterValues: { status: ['open'] } });
    expect(await codeOf(assertCanWriteRecord(s, 'update', 'actor', 'closed'))).toBe('NOT_FOUND');
    expect(await codeOf(assertCanWriteRecord(s, 'update', 'actor', 'mine'))).toBe('ok');
  });

  it('x-self-only: only the creator may write; another user\'s record is absent (404); no role check', async () => {
    const s = spec({ selfOnly: true });
    expect(await codeOf(assertCanWriteRecord(s, 'update', 'actor', 'mine'))).toBe('ok');
    expect(await codeOf(assertCanWriteRecord(s, 'delete', 'actor', 'someone-else'))).toBe('NOT_FOUND');
    expect(requireEntityPermission).not.toHaveBeenCalled();
    expect(requireRecordPermission).not.toHaveBeenCalled();
  });

  it('x-self-only still applies the organization scope', async () => {
    expect(await codeOf(assertCanWriteRecord(spec({ selfOnly: true }), 'update', 'actor', 'other-org'))).toBe('NOT_FOUND');
  });

  it('is denied without an actor', async () => {
    const s = spec();
    expect(await codeOf(assertCanWriteRecord(s, 'update', '', 'mine'))).toBe('PERMISSION_DENIED');
    expect(s.load).not.toHaveBeenCalled();
  });
});

describe('assertCanDeleteRecords', () => {
  it('returns the ids, each checked once', async () => {
    const s = spec();
    expect(await assertCanDeleteRecords(s, 'actor', ['mine', 'mine', 'closed'])).toEqual(['mine', 'closed']);
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  it('refuses the whole request when one record is in another organization', async () => {
    expect(await codeOf(assertCanDeleteRecords(spec(), 'actor', ['mine', 'other-org']))).toBe('NOT_FOUND');
  });

  it('refuses the whole request when one record may not be deleted', async () => {
    requireRecordPermission.mockImplementation(async (_e: string, _o: string, row: Row) => {
      if (row.id === 'someone-else') throw denied('thing', 'delete');
      return {};
    });
    expect(await codeOf(assertCanDeleteRecords(spec(), 'actor', ['mine', 'someone-else']))).toBe('PERMISSION_DENIED');
  });
});
