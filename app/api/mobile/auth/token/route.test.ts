import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique, recoveryFindMany, verifyTotpStep } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  recoveryFindMany: vi.fn(),
  verifyTotpStep: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique },
    mfa_recovery_code: { findMany: recoveryFindMany, update: vi.fn() },
  },
}));
const { bcryptCompare } = vi.hoisted(() => ({ bcryptCompare: vi.fn() }));
vi.mock('bcryptjs', () => ({
  default: { compare: bcryptCompare, hash: vi.fn().mockResolvedValue('dummy-hash') },
}));
vi.mock('@/lib/mfa/crypto', () => ({ decryptSecret: (s: string) => s }));
vi.mock('@/lib/mfa/totp', () => ({ verifyTotpStep }));
vi.mock('@/lib/mfa/recovery', () => ({ verifyRecoveryCode: vi.fn().mockResolvedValue(false) }));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
vi.mock('@/lib/authz', () => ({ requireEntityPermission: vi.fn(), requireRecordPermission: vi.fn(), getSessionUserId: vi.fn() }));
vi.mock('@/lib/mobile-auth', () => ({
  isMobileJwt: () => false,
  verifyMobileAccessToken: vi.fn(),
  MobileAuthError: class MobileAuthError extends Error {},
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_MS: 1000,
  generateRefreshTokenPlaintext: () => 'r',
  hashRefreshToken: (s: string) => s,
  signMobileAccessToken: vi.fn(),
}));

import { _resetForTests } from '@/lib/rate-limit';
import { POST } from './route';

// Distinct client IPs keep the per-(IP, email) `mobile:auth:token` bucket out
// of the way, so only the per-user MFA budget can produce the 429 under test.
function tokenRequest(n: number) {
  return new Request('http://localhost/api/mobile/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${n}` },
    body: JSON.stringify({ email: 'mfa@example.com', password: 'pw', mfa_code: '000000' }),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  _resetForTests();
  bcryptCompare.mockReset();
  bcryptCompare.mockResolvedValue(true);
  verifyTotpStep.mockResolvedValue(null);
  recoveryFindMany.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({
    id: 'user-1',
    password: 'hash',
    mfa_enabled: true,
    mfa_secret: 'secret',
    anonymized_at: null,
  });
});

describe('POST /api/mobile/auth/token MFA throttling', () => {
  it('answers 429 once the per-user MFA budget is spent, across client IPs', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await POST(tokenRequest(i));
      expect(res.status).toBe(401);
    }

    const blocked = await POST(tokenRequest(11));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

describe('POST /api/mobile/auth/token password timing', () => {
  it.each([
    ['an unknown email', null],
    ['an SSO-only account', { id: 'user-2', password: null, mfa_enabled: false, anonymized_at: null }],
  ])('runs a password comparison even for %s, so it takes as long as a wrong password', async (_label, user) => {
    userFindUnique.mockResolvedValue(user);

    const res = await POST(tokenRequest(50));

    expect(res.status).toBe(401);
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
  });

  it('answers a wrong password and an unknown email with the same status', async () => {
    bcryptCompare.mockResolvedValue(false);
    const wrong = await POST(tokenRequest(51));
    userFindUnique.mockResolvedValue(null);
    const unknown = await POST(tokenRequest(52));

    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.json()).toEqual(await unknown.json());
  });
});

describe('POST /api/mobile/auth/token account lockout', () => {
  it('answers 429 for the account after repeated wrong passwords from different IPs, even with the right one', async () => {
    userFindUnique.mockResolvedValue({ id: 'user-1', password: 'hash', mfa_enabled: false, anonymized_at: null });
    bcryptCompare.mockResolvedValue(false);
    for (let i = 1; i <= 10; i++) expect((await POST(tokenRequest(i))).status).toBe(401);
    bcryptCompare.mockResolvedValue(true);
    const locked = await POST(tokenRequest(99));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
