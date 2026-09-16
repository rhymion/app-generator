/**
 * Issue #588: `completeMfaChallenge` is a Server Action, not covered by
 * proxy.ts's `/api/auth/*` rate-limit matcher, so it previously had no
 * brute-force protection on the second factor at all. These tests exercise
 * the `auth:mfa:challenge` gate added to close that hole, keyed by the
 * session's user id (see lib/rate-limit/index.ts doc comment for why user
 * id rather than IP).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, unstableUpdateMock, verifyMfaCodeMock, rateLimitCheckMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  unstableUpdateMock: vi.fn(),
  verifyMfaCodeMock: vi.fn(),
  rateLimitCheckMock: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: authMock,
  unstable_update: unstableUpdateMock,
}));

vi.mock('@/lib/mfa/verify', () => ({
  verifyMfaCode: verifyMfaCodeMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rateLimitCheckMock }),
}));

import { completeMfaChallenge } from './actions';

const PENDING_SESSION = { user: { id: 'user-1' }, mfa_pending: true };

describe('completeMfaChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns SESSION_REQUIRED without checking the rate limiter when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await completeMfaChallenge('123456');

    expect(result).toEqual({ ok: false, error: 'SESSION_REQUIRED' });
    expect(rateLimitCheckMock).not.toHaveBeenCalled();
  });

  it('is a no-op success when mfa_pending is already false', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user-1' }, mfa_pending: false });

    const result = await completeMfaChallenge('123456');

    expect(result).toEqual({ ok: true });
    expect(rateLimitCheckMock).not.toHaveBeenCalled();
  });

  it('blocks verification once the auth:mfa:challenge bucket is exhausted (pre-fix: unreachable — no gate existed)', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    rateLimitCheckMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
      resetAt: Date.now() + 42_000,
    });

    const result = await completeMfaChallenge('000000');

    expect(result).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 42 });
    // The whole point of the fix: a blocked attempt must never reach
    // verifyMfaCode (no TOTP/recovery-code guess is spent against the DB).
    expect(verifyMfaCodeMock).not.toHaveBeenCalled();
    expect(rateLimitCheckMock).toHaveBeenCalledWith('auth:mfa:challenge', 'user-1');
  });

  it('verifies the code and clears mfa_pending when allowed and the code is valid', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    rateLimitCheckMock.mockResolvedValueOnce({ allowed: true, remaining: 9, retryAfterSeconds: 0, resetAt: 0 });
    verifyMfaCodeMock.mockResolvedValueOnce(true);

    const result = await completeMfaChallenge(' 123456 ');

    expect(result).toEqual({ ok: true });
    expect(verifyMfaCodeMock).toHaveBeenCalledWith('user-1', '123456');
    expect(unstableUpdateMock).toHaveBeenCalledWith({ mfa_pending: false });
  });

  it('returns INVALID_CODE when allowed but the code is wrong, still counting against the bucket', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    rateLimitCheckMock.mockResolvedValueOnce({ allowed: true, remaining: 5, retryAfterSeconds: 0, resetAt: 0 });
    verifyMfaCodeMock.mockResolvedValueOnce(false);

    const result = await completeMfaChallenge('999999');

    expect(result).toEqual({ ok: false, error: 'INVALID_CODE' });
    expect(rateLimitCheckMock).toHaveBeenCalledTimes(1);
    expect(unstableUpdateMock).not.toHaveBeenCalled();
  });
});
