import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique, userUpdateMany, recoveryFindMany, recoveryUpdateMany, verifyTotpStep, verifyRecoveryCode, reencryptedSecret } = vi.hoisted(() => ({
  reencryptedSecret: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdateMany: vi.fn(),
  recoveryFindMany: vi.fn(),
  recoveryUpdateMany: vi.fn(),
  verifyTotpStep: vi.fn(),
  verifyRecoveryCode: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique, updateMany: userUpdateMany },
    mfa_recovery_code: { findMany: recoveryFindMany, updateMany: recoveryUpdateMany },
  },
}));
vi.mock('./crypto', () => ({ decryptSecret: (s: string) => s, reencryptedSecret }));
vi.mock('./totp', () => ({ verifyTotpStep }));
vi.mock('./recovery', () => ({ verifyRecoveryCode }));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests } from '@/lib/rate-limit';
import { MfaRateLimitedError } from './errors';
import { verifyMfaCode } from './verify';

beforeEach(() => {
  _resetForTests();
  userFindUnique.mockReset();
  recoveryFindMany.mockReset();
  userUpdateMany.mockReset();
  recoveryUpdateMany.mockReset();
  verifyTotpStep.mockReset();
  verifyRecoveryCode.mockReset();
  reencryptedSecret.mockReset();
  reencryptedSecret.mockReturnValue(null);
  userFindUnique.mockResolvedValue({ id: 'user-1', mfa_secret: 'secret', mfa_enabled: true, mfa_last_totp_step: null });
  recoveryFindMany.mockResolvedValue([]);
  verifyTotpStep.mockResolvedValue(null);
  verifyRecoveryCode.mockResolvedValue(false);
  userUpdateMany.mockResolvedValue({ count: 1 });
  recoveryUpdateMany.mockResolvedValue({ count: 1 });
});

describe('verifyMfaCode rate limit', () => {
  it('allows exactly 10 attempts per user, then throws before evaluating a guess', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(verifyMfaCode('user-1', '000000')).resolves.toBe(false);
    }
    verifyTotpStep.mockClear();

    await expect(verifyMfaCode('user-1', '000000')).rejects.toBeInstanceOf(MfaRateLimitedError);
    expect(verifyTotpStep).not.toHaveBeenCalled();
  });

  it('budgets each user separately', async () => {
    for (let i = 0; i < 10; i++) await verifyMfaCode('user-1', '000000');

    await expect(verifyMfaCode('user-2', '000000')).resolves.toBe(false);
  });
});

describe('verifyMfaCode one-time use', () => {
  it('passes the last accepted step to the TOTP check, so a code from that step is refused', async () => {
    userFindUnique.mockResolvedValue({ id: 'user-1', mfa_secret: 'secret', mfa_enabled: true, mfa_last_totp_step: 100 });
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(false);
    expect(verifyTotpStep).toHaveBeenCalledWith('secret', '123456', 100);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('records the accepted step with a conditional write', async () => {
    verifyTotpStep.mockResolvedValue(101);
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(true);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', OR: [{ mfa_last_totp_step: null }, { mfa_last_totp_step: { lt: 101 } }] },
      data: { mfa_last_totp_step: 101 },
    });
  });

  it('refuses a code when a concurrent request already claimed its step', async () => {
    verifyTotpStep.mockResolvedValue(101);
    userUpdateMany.mockResolvedValue({ count: 0 });
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(false);
  });

  it('accepts a recovery code once: the row is stamped only while still unused', async () => {
    recoveryFindMany.mockResolvedValue([{ id: 'rc-1', code_hash: 'h' }]);
    verifyRecoveryCode.mockResolvedValue(true);
    await expect(verifyMfaCode('user-1', 'abcd-efgh')).resolves.toBe(true);
    expect(recoveryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'rc-1', used_at: null },
      data: { used_at: expect.any(Date) },
    });
  });

  it('refuses a recovery code that a concurrent request already used', async () => {
    recoveryFindMany.mockResolvedValue([{ id: 'rc-1', code_hash: 'h' }]);
    verifyRecoveryCode.mockResolvedValue(true);
    recoveryUpdateMany.mockResolvedValue({ count: 0 });
    await expect(verifyMfaCode('user-1', 'abcd-efgh')).resolves.toBe(false);
  });

  it('does not offer a used recovery code again: only unused rows are looked up', async () => {
    await verifyMfaCode('user-1', 'abcd-efgh');
    expect(recoveryFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 'user-1', used_at: null } }));
  });
});

describe('verifyMfaCode re-encryption (Issue #1291)', () => {
  it('rewrites a secret not under the current key after an accepted code, conditional on the stored value', async () => {
    verifyTotpStep.mockResolvedValue(101);
    reencryptedSecret.mockReturnValue('v2:newkey:n:t:c');
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(true);
    expect(reencryptedSecret).toHaveBeenCalledWith('secret', 'secret');
    expect(userUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'user-1', mfa_secret: 'secret' },
      data: { mfa_secret: 'v2:newkey:n:t:c' },
    });
  });

  it('writes nothing more when the secret is already under the current key', async () => {
    verifyTotpStep.mockResolvedValue(101);
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(true);
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('does not re-encrypt after a refused code', async () => {
    reencryptedSecret.mockReturnValue('v2:newkey:n:t:c');
    await expect(verifyMfaCode('user-1', '000000')).resolves.toBe(false);
    expect(reencryptedSecret).not.toHaveBeenCalled();
  });

  it('still accepts the code when the re-encryption write fails', async () => {
    verifyTotpStep.mockResolvedValue(101);
    reencryptedSecret.mockReturnValue('v2:newkey:n:t:c');
    userUpdateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('db down'));
    await expect(verifyMfaCode('user-1', '123456')).resolves.toBe(true);
  });
});
