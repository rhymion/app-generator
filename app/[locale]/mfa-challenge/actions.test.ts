/**
 * Issue #588: `completeMfaChallenge` is a Server Action, not covered by
 * proxy.ts's `/api/auth/*` rate-limit matcher, so it previously had no
 * brute-force protection on the second factor at all. The `auth:mfa:challenge`
 * bucket (keyed by the session's user id) is now enforced inside
 * `verifyMfaCode`; these tests cover how the action maps its outcome. The
 * budget itself is covered in lib/mfa/verify.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, unstableUpdateMock, verifyMfaCodeMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  unstableUpdateMock: vi.fn(),
  verifyMfaCodeMock: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: authMock,
  unstable_update: unstableUpdateMock,
}));

vi.mock('@/lib/mfa/verify', () => ({
  verifyMfaCode: verifyMfaCodeMock,
}));

import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { completeMfaChallenge } from './actions';

const PENDING_SESSION = { user: { id: 'user-1' }, mfa_pending: true };

describe('completeMfaChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns SESSION_REQUIRED without verifying when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await completeMfaChallenge('123456');

    expect(result).toEqual({ ok: false, error: 'SESSION_REQUIRED' });
    expect(verifyMfaCodeMock).not.toHaveBeenCalled();
  });

  it('is a no-op success when mfa_pending is already false', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user-1' }, mfa_pending: false });

    const result = await completeMfaChallenge('123456');

    expect(result).toEqual({ ok: true });
    expect(verifyMfaCodeMock).not.toHaveBeenCalled();
  });

  it('maps the MfaRateLimitedError from verifyMfaCode to RATE_LIMITED with its retry delay', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    verifyMfaCodeMock.mockRejectedValueOnce(new MfaRateLimitedError(42));

    const result = await completeMfaChallenge('000000');

    expect(result).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterSeconds: 42 });
    expect(unstableUpdateMock).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected verification failure', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    verifyMfaCodeMock.mockRejectedValueOnce(new Error('db down'));

    await expect(completeMfaChallenge('000000')).rejects.toThrow('db down');
  });

  it('verifies the code and clears mfa_pending when the code is valid', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    verifyMfaCodeMock.mockResolvedValueOnce(true);

    const result = await completeMfaChallenge(' 123456 ');

    expect(result).toEqual({ ok: true });
    expect(verifyMfaCodeMock).toHaveBeenCalledWith('user-1', '123456');
    expect(unstableUpdateMock).toHaveBeenCalledWith({ mfa_pending: false });
  });

  it('returns INVALID_CODE when the code is wrong', async () => {
    authMock.mockResolvedValue(PENDING_SESSION);
    verifyMfaCodeMock.mockResolvedValueOnce(false);

    const result = await completeMfaChallenge('999999');

    expect(result).toEqual({ ok: false, error: 'INVALID_CODE' });
    expect(unstableUpdateMock).not.toHaveBeenCalled();
  });
});
