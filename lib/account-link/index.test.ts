import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted, so shared mocks have to be declared via vi.hoisted
// to be available when the factory runs. Same pattern as audit-log.test.ts.
const mocks = vi.hoisted(() => ({
  accountFindMany: vi.fn(),
  accountFindFirst: vi.fn(),
  accountCount: vi.fn(),
  accountDelete: vi.fn(),
  userFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  // tx client exposes the same shape so the lib's casts work inside the
  // $transaction callback.
  const tx = {
    account: {
      findFirst: mocks.accountFindFirst,
      count:     mocks.accountCount,
      delete:    mocks.accountDelete,
    },
    user: { findUnique: mocks.userFindUnique },
    audit_log: { create: mocks.auditCreate },
  };
  mocks.transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return {
    default: {
      account: {
        findMany:  mocks.accountFindMany,
        findFirst: mocks.accountFindFirst,
        count:     mocks.accountCount,
        delete:    mocks.accountDelete,
      },
      user: { findUnique: mocks.userFindUnique },
      audit_log: { create: mocks.auditCreate },
      $transaction: mocks.transaction,
    },
  };
});

vi.mock('@/lib/site-config', () => ({
  siteConfig: { auth: { providers: ['credentials', 'google'] } },
}));

import {
  DetachAccountError,
  availableProvidersForLinking,
  detachAccount,
  hasAnotherSignInMethod,
  listLinkedAccounts,
} from './index';


beforeEach(() => {
  for (const fn of Object.values(mocks)) (fn as ReturnType<typeof vi.fn>).mockReset();
  mocks.auditCreate.mockResolvedValue({ id: 'audit-cuid' });
  mocks.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    const tx = {
      account: {
        findFirst: mocks.accountFindFirst,
        count:     mocks.accountCount,
        delete:    mocks.accountDelete,
      },
      user: { findUnique: mocks.userFindUnique },
      audit_log: { create: mocks.auditCreate },
    };
    return fn(tx);
  });
});


describe('listLinkedAccounts', () => {
  it('queries Account rows by userId', async () => {
    mocks.accountFindMany.mockResolvedValueOnce([
      { id: 'a1', provider: 'google', providerAccountId: 'g-1' },
    ]);
    const rows = await listLinkedAccounts('u1');
    expect(rows).toEqual([
      { id: 'a1', provider: 'google', providerAccountId: 'g-1' },
    ]);
    expect(mocks.accountFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { id: true, provider: true, providerAccountId: true },
      orderBy: { provider: 'asc' },
    });
  });
});


describe('availableProvidersForLinking', () => {
  it('returns OAuth providers from siteConfig minus already-linked', async () => {
    mocks.accountFindMany.mockResolvedValueOnce([]);
    expect(await availableProvidersForLinking('u1')).toEqual(['google']);
  });

  it('drops providers that already have an Account row', async () => {
    mocks.accountFindMany.mockResolvedValueOnce([
      { id: 'a1', provider: 'google', providerAccountId: 'g-1' },
    ]);
    expect(await availableProvidersForLinking('u1')).toEqual([]);
  });

  it('never offers credentials (not an OAuth flow)', async () => {
    mocks.accountFindMany.mockResolvedValueOnce([]);
    const avail = await availableProvidersForLinking('u1');
    expect(avail).not.toContain('credentials');
  });
});


describe('hasAnotherSignInMethod', () => {
  it('returns true when the user has a password set', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ password: 'hashed' });
    mocks.accountCount.mockResolvedValueOnce(0);
    expect(await hasAnotherSignInMethod('u1')).toBe(true);
  });

  it('returns true when the user has no password but has account rows', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ password: null });
    mocks.accountCount.mockResolvedValueOnce(2);
    expect(await hasAnotherSignInMethod('u1')).toBe(true);
  });

  it('returns false when no password and no accounts', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ password: null });
    mocks.accountCount.mockResolvedValueOnce(0);
    expect(await hasAnotherSignInMethod('u1')).toBe(false);
  });

  it('subtracts the excluded account when asked', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ password: null });
    mocks.accountCount.mockResolvedValueOnce(1);
    // 1 account total, excluding the one about to be removed → 0 left.
    expect(await hasAnotherSignInMethod('u1', 'a1')).toBe(false);
  });
});


describe('detachAccount', () => {
  it('deletes the row when the user still has a password', async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({ id: 'a1', provider: 'google' });
    mocks.userFindUnique.mockResolvedValueOnce({ password: 'hashed' });

    await detachAccount('u1', 'a1');

    expect(mocks.accountDelete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const [{ data }] = mocks.auditCreate.mock.calls[0];
    expect(data.action).toBe('auth:account.unlink');
    expect(data.actor_user_id).toBe('u1');
    expect(data.target_id).toBe('a1');
    expect(data.metadata).toEqual({ provider: 'google' });
  });

  it('deletes when password is missing but other Account rows remain', async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({ id: 'a1', provider: 'google' });
    mocks.userFindUnique.mockResolvedValueOnce({ password: null });
    mocks.accountCount.mockResolvedValueOnce(2);

    await detachAccount('u1', 'a1');

    expect(mocks.accountDelete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('throws last_sign_in_method when removal would strand the user', async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({ id: 'a1', provider: 'google' });
    mocks.userFindUnique.mockResolvedValueOnce({ password: null });
    mocks.accountCount.mockResolvedValueOnce(1);

    const caught = await detachAccount('u1', 'a1').catch((e) => e);
    expect(caught).toBeInstanceOf(DetachAccountError);
    expect((caught as DetachAccountError).code).toBe('last_sign_in_method');
    expect(mocks.accountDelete).not.toHaveBeenCalled();
  });

  it('throws not_found when the account does not belong to the user', async () => {
    mocks.accountFindFirst.mockResolvedValueOnce(null);

    await expect(detachAccount('u1', 'a-other')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(mocks.accountDelete).not.toHaveBeenCalled();
  });

  it('audit-logs against the deleted account id, not a leaked alternative', async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({ id: 'a-keep', provider: 'google' });
    mocks.userFindUnique.mockResolvedValueOnce({ password: 'hashed' });

    await detachAccount('u1', 'a-keep');

    const [{ data }] = mocks.auditCreate.mock.calls[0];
    expect(data.target_id).toBe('a-keep');
  });
});
