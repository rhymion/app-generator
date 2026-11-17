import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, disableMfaMock, checkMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  disableMfaMock: vi.fn(),
  checkMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/mfa/enrollment', () => ({ disableMfa: disableMfaMock }));
// The real module pulls in next-auth; only the error type is needed here.
vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public statusCode: number, message: string, public retryAfterSeconds?: number) {
      super(message);
    }
  },
}));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check: checkMock }) }));

import { ApiError } from '@/lib/api-auth';
import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { confirmCredentialChange } from './credential-confirmation';

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the call to reject');
}

describe('confirmCredentialChange', () => {
  let hash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    hash = await bcrypt.hash('current-pw', 4);
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    checkMock.mockResolvedValue({ allowed: true });
    disableMfaMock.mockResolvedValue(undefined);
  });

  it('changes nothing and asks for nothing when neither field is submitted', async () => {
    expect(await confirmCredentialChange('u1', {})).toEqual({ password: '', mfaEnabled: true });
    expect(await confirmCredentialChange('u1', { password: '', mfaEnabled: true })).toEqual({ password: '', mfaEnabled: true });
    expect(disableMfaMock).not.toHaveBeenCalled();
  });

  it('rejects a new password without the current password', async () => {
    const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123' }));
    expect(err.statusCode).toBe(400);
  });

  it('rejects a new password under the minimum length once the current password is confirmed', async () => {
    const err = await rejection(confirmCredentialChange('u1', { password: 'short', currentPassword: 'current-pw' }));
    expect(err.statusCode).toBe(400);
  });

  it('rejects a new password with a wrong current password', async () => {
    const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'nope' }));
    expect(err.statusCode).toBe(403);
  });

  it('rejects a password change for an account that has no password', async () => {
    findUniqueMock.mockResolvedValue({ password: null, mfa_enabled: false, email: 'me@example.com' });
    const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'anything' }));
    expect(err.statusCode).toBe(403);
  });

  it('stores a hash of the new password once the current password is confirmed', async () => {
    const out = await confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw' });
    expect(out.password).not.toBe('new-pw-123');
    expect(await bcrypt.compare('new-pw-123', out.password)).toBe(true);
  });

  it('rejects a changed email address without the current password', async () => {
    const err = await rejection(confirmCredentialChange('u1', { email: 'other@example.com' }));
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('email');
  });

  it('rejects a changed email address with a wrong current password', async () => {
    const err = await rejection(confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'nope' }));
    expect(err.statusCode).toBe(403);
  });

  it('rejects an email change for an account that has no password', async () => {
    findUniqueMock.mockResolvedValue({ password: null, mfa_enabled: false, email: 'me@example.com' });
    const err = await rejection(confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'anything' }));
    expect(err.statusCode).toBe(403);
  });

  it('accepts a changed email address once the current password is confirmed, without touching the password', async () => {
    const out = await confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'current-pw' });
    expect(out).toEqual({ password: '', mfaEnabled: true });
  });

  it('asks for nothing when the email is resent unchanged, whatever its case or padding', async () => {
    expect(await confirmCredentialChange('u1', { email: ' ME@Example.com ' })).toEqual({ password: '', mfaEnabled: true });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('answers 429 once the confirmation budget is spent, before comparing', async () => {
    checkMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw' }));
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it('rejects turning MFA off without a code and leaves MFA untouched', async () => {
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false }));
    expect(err.statusCode).toBe(400);
    expect(disableMfaMock).not.toHaveBeenCalled();
  });

  it('rejects turning MFA off with an invalid code', async () => {
    disableMfaMock.mockRejectedValue(new Error('Invalid MFA code'));
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: '000000' }));
    expect(err.statusCode).toBe(403);
  });

  it('maps an exhausted MFA budget to 429', async () => {
    disableMfaMock.mockRejectedValue(new MfaRateLimitedError(12));
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: '123456' }));
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(12);
  });

  it('turns MFA off through disableMfa when the code is accepted', async () => {
    const out = await confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: ' 123456 ' });
    expect(disableMfaMock).toHaveBeenCalledWith('u1', '123456');
    expect(out.mfaEnabled).toBe(false);
  });

  it('rejects turning MFA on, which needs the enrollment flow', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: false });
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: true }));
    expect(err.statusCode).toBe(400);
  });

  it('does not ask for a code when MFA is already off and stays off', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: false });
    expect(await confirmCredentialChange('u1', { mfaEnabled: false })).toEqual({ password: '', mfaEnabled: false });
    expect(disableMfaMock).not.toHaveBeenCalled();
  });
});
