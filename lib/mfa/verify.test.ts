import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique, recoveryFindMany, verifyTotp } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  recoveryFindMany: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique },
    mfa_recovery_code: { findMany: recoveryFindMany, update: vi.fn() },
  },
}));
vi.mock('./crypto', () => ({ decryptSecret: (s: string) => s }));
vi.mock('./totp', () => ({ verifyTotp }));
vi.mock('./recovery', () => ({ verifyRecoveryCode: vi.fn().mockResolvedValue(false) }));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests } from '@/lib/rate-limit';
import { MfaRateLimitedError } from './errors';
import { verifyMfaCode } from './verify';

beforeEach(() => {
  _resetForTests();
  userFindUnique.mockReset();
  recoveryFindMany.mockReset();
  verifyTotp.mockReset();
  userFindUnique.mockResolvedValue({ id: 'user-1', mfa_secret: 'secret', mfa_enabled: true });
  recoveryFindMany.mockResolvedValue([]);
  verifyTotp.mockResolvedValue(false);
});

describe('verifyMfaCode rate limit', () => {
  it('allows exactly 10 attempts per user, then throws before evaluating a guess', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(verifyMfaCode('user-1', '000000')).resolves.toBe(false);
    }
    verifyTotp.mockClear();

    await expect(verifyMfaCode('user-1', '000000')).rejects.toBeInstanceOf(MfaRateLimitedError);
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('budgets each user separately', async () => {
    for (let i = 0; i < 10; i++) await verifyMfaCode('user-1', '000000');

    await expect(verifyMfaCode('user-2', '000000')).resolves.toBe(false);
  });
});
