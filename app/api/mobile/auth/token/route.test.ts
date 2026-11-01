import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique, recoveryFindMany, verifyTotpStep, sessionCreate } = vi.hoisted(() => ({
  sessionCreate: vi.fn().mockResolvedValue({ id: 'session-1' }),
  userFindUnique: vi.fn(),
  recoveryFindMany: vi.fn(),
  verifyTotpStep: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique },
    mfa_recovery_code: { findMany: recoveryFindMany, update: vi.fn() },
    mobile_session: { create: sessionCreate, update: vi.fn() },
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
  signMobileAccessToken: vi.fn().mockResolvedValue('access-token'),
}));

import { _resetForTests, DEFAULT_BUCKETS } from '@/lib/rate-limit';
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

function tokenRequestWith(headers: Record<string, string>) {
  return new Request('http://localhost/api/mobile/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'mfa@example.com', password: 'pw' }),
  }) as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/mobile/auth/token account lockout', () => {
  const plainUser = { id: 'user-1', password: 'hash', mfa_enabled: false, anonymized_at: null };
  const TIER2 = DEFAULT_BUCKETS['auth:account:lockout:email'].limit;

  it("failures from other addresses do not stop the owner's address from signing in", async () => {
    userFindUnique.mockResolvedValue(plainUser);
    bcryptCompare.mockResolvedValue(false);
    for (let i = 1; i <= 30; i++) expect((await POST(tokenRequest(i))).status).toBe(401);
    bcryptCompare.mockResolvedValue(true);
    const owner = await POST(tokenRequest(200));
    expect(owner.status).toBe(201);
  });

  it('answers 429 with Retry-After once failures from many addresses spend the email-wide ceiling, even with the right password', async () => {
    userFindUnique.mockResolvedValue(plainUser);
    bcryptCompare.mockResolvedValue(false);
    for (let i = 0; i < TIER2; i++) {
      expect((await POST(tokenRequestWith({ 'x-forwarded-for': `10.9.${Math.floor(i / 250)}.${i % 250}` }))).status).toBe(401);
    }
    bcryptCompare.mockResolvedValue(true);
    const locked = await POST(tokenRequest(201));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('still stops at the email-wide ceiling when a spoofable header gives every request a fresh address', async () => {
    userFindUnique.mockResolvedValue(plainUser);
    bcryptCompare.mockResolvedValue(false);
    for (let i = 0; i < TIER2; i++) {
      expect((await POST(tokenRequestWith({ 'x-real-ip': `spoof-${i}` }))).status).toBe(401);
    }
    bcryptCompare.mockResolvedValue(true);
    expect((await POST(tokenRequestWith({ 'x-real-ip': 'spoof-next' }))).status).toBe(429);
  });
});
