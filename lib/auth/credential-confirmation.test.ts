import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, disableMfaMock, verifyMfaCodeMock, checkMock, verificationOn, startEmailChangeMock, endSessionsMock } =
  vi.hoisted(() => ({
    findUniqueMock: vi.fn(),
    disableMfaMock: vi.fn(),
    verifyMfaCodeMock: vi.fn(),
    checkMock: vi.fn(),
    verificationOn: { value: false },
    startEmailChangeMock: vi.fn(),
    endSessionsMock: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/mfa/enrollment', () => ({ disableMfa: disableMfaMock }));
vi.mock('@/lib/mfa/verify', () => ({ verifyMfaCode: verifyMfaCodeMock }));
vi.mock('./end-sessions', () => ({ endSessionsAfterChange: endSessionsMock }));
// The real module pulls in next-auth; only the error type is needed here.
vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public statusCode: number, message: string, public retryAfterSeconds?: number) {
      super(message);
    }
  },
}));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check: checkMock }) }));
vi.mock('./email-change', () => ({
  emailChangeNeedsVerification: () => verificationOn.value,
  startEmailChange: startEmailChangeMock,
}));

import { ApiError } from '@/lib/api-auth';
import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { siteConfig } from '@/lib/site-config';
import { CredentialConfirmationError, confirmCredentialChange, credentialActionFailure } from './credential-confirmation';

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
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: false, email: 'me@example.com' });
    checkMock.mockResolvedValue({ allowed: true });
    disableMfaMock.mockResolvedValue(undefined);
    verifyMfaCodeMock.mockResolvedValue(true);
    endSessionsMock.mockResolvedValue(undefined);
    startEmailChangeMock.mockResolvedValue(undefined);
    verificationOn.value = false;
  });

  it('changes nothing and asks for nothing when neither field is submitted', async () => {
    expect(await confirmCredentialChange('u1', {})).toEqual({ password: '', mfaEnabled: false });
    expect(await confirmCredentialChange('u1', { password: '', mfaEnabled: false })).toEqual({ password: '', mfaEnabled: false });
    expect(disableMfaMock).not.toHaveBeenCalled();
    expect(endSessionsMock).not.toHaveBeenCalled();
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
    expect(endSessionsMock).toHaveBeenCalledWith('u1');
  });

  it('ends no session when the change is refused', async () => {
    await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'nope' }));
    expect(endSessionsMock).not.toHaveBeenCalled();
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
    expect(out).toEqual({ password: '', mfaEnabled: false, email: 'other@example.com' });
    expect(startEmailChangeMock).not.toHaveBeenCalled();
    // Stored at once (verification off): the other sessions end.
    expect(endSessionsMock).toHaveBeenCalledWith('u1');
  });

  it('asks for nothing when the email is resent unchanged, whatever its case or padding', async () => {
    expect(await confirmCredentialChange('u1', { email: ' ME@Example.com ' })).toEqual({ password: '', mfaEnabled: false, email: ' ME@Example.com ' });
    expect(checkMock).not.toHaveBeenCalled();
  });

  // Issue #1400: with email verification on, the new address waits for its link.
  describe('with email verification on', () => {
    beforeEach(() => {
      verificationOn.value = true;
    });

    it('keeps the current address and mails a link to the new one', async () => {
      const out = await confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'current-pw' });
      expect(out.email).toBe('me@example.com');
      expect(startEmailChangeMock).toHaveBeenCalledWith({ userId: 'u1', currentEmail: 'me@example.com', newEmail: 'other@example.com' });
      // The sessions end when the link is used, not on the request.
      expect(endSessionsMock).not.toHaveBeenCalled();
    });

    it('sends nothing when the current password is wrong', async () => {
      await rejection(confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'nope' }));
      expect(startEmailChangeMock).not.toHaveBeenCalled();
    });

    it('sends nothing when the address is resent unchanged', async () => {
      const out = await confirmCredentialChange('u1', { email: 'Me@Example.com' });
      expect(out.email).toBe('Me@Example.com');
      expect(startEmailChangeMock).not.toHaveBeenCalled();
    });

    it('sends nothing when another part of the save is refused', async () => {
      findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
      disableMfaMock.mockRejectedValue(new Error('Invalid MFA code'));
      await rejection(confirmCredentialChange('u1', {
        email: 'other@example.com', currentPassword: 'current-pw', mfaEnabled: false, mfaCode: '000000',
      }));
      expect(startEmailChangeMock).not.toHaveBeenCalled();
    });
  });

  // Issue #1402: a new address obeys the registration domain allow-list, as sign-up does.
  describe('with a registration domain allow-list', () => {
    const auth = siteConfig.auth as { registrationAllowedDomains: readonly string[] };
    let savedDomains: readonly string[];

    beforeEach(() => {
      savedDomains = auth.registrationAllowedDomains;
      auth.registrationAllowedDomains = ['example.com'];
    });
    afterEach(() => {
      auth.registrationAllowedDomains = savedDomains;
    });

    it.each([false, true])('refuses an address outside the list on the email field (verification %s)', async (on) => {
      verificationOn.value = on;
      const err = await rejection(confirmCredentialChange('u1', { email: 'me@evil.net', currentPassword: 'current-pw' }));
      expect(err).toBeInstanceOf(CredentialConfirmationError);
      expect((err as CredentialConfirmationError).field).toBe('email');
      expect(err.statusCode).toBe(400);
      // The message does not name the list.
      expect(err.message).not.toContain('example.com');
      expect(startEmailChangeMock).not.toHaveBeenCalled();
      expect(endSessionsMock).not.toHaveBeenCalled();
    });

    it('refuses a subdomain or a look-alike domain', async () => {
      for (const email of ['me@sub.example.com', 'me@example.com.evil.net', '"me@example.com"@evil.net']) {
        const err = await rejection(confirmCredentialChange('u1', { email, currentPassword: 'current-pw' }));
        expect((err as CredentialConfirmationError).field).toBe('email');
      }
    });

    it('refuses before the password check, so no confirmation attempt or MFA code is used', async () => {
      findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
      await rejection(confirmCredentialChange('u1', { email: 'me@evil.net', currentPassword: 'nope', mfaCode: '123456' }));
      expect(checkMock).not.toHaveBeenCalled();
      expect(verifyMfaCodeMock).not.toHaveBeenCalled();
    });

    it('accepts an address in a listed domain, whatever its case', async () => {
      const out = await confirmCredentialChange('u1', { email: 'Other@EXAMPLE.com', currentPassword: 'current-pw' });
      expect(out.email).toBe('Other@EXAMPLE.com');
    });

    it('does not re-check an unchanged address, so an account outside a narrowed list can still save', async () => {
      findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: false, email: 'me@legacy.org' });
      expect(await confirmCredentialChange('u1', { email: 'me@legacy.org' })).toMatchObject({ email: 'me@legacy.org' });
      const out = await confirmCredentialChange('u1', { email: 'me@legacy.org', password: 'new-pw-123', currentPassword: 'current-pw' });
      expect(out.password).not.toBe('');
    });
  });

  it('answers 429 once the confirmation budget is spent, before comparing', async () => {
    checkMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw' }));
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it('rejects turning MFA off without a code and leaves MFA untouched', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false }));
    expect(err.statusCode).toBe(400);
    expect(disableMfaMock).not.toHaveBeenCalled();
  });

  it('rejects turning MFA off with an invalid code', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    disableMfaMock.mockRejectedValue(new Error('Invalid MFA code'));
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: '000000' }));
    expect(err.statusCode).toBe(403);
  });

  it('maps an exhausted MFA budget to 429', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    disableMfaMock.mockRejectedValue(new MfaRateLimitedError(12));
    const err = await rejection(confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: '123456' }));
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(12);
  });

  it('turns MFA off through disableMfa when the code is accepted', async () => {
    findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    const out = await confirmCredentialChange('u1', { mfaEnabled: false, mfaCode: ' 123456 ' });
    expect(disableMfaMock).toHaveBeenCalledWith('u1', '123456');
    expect(out.mfaEnabled).toBe(false);
    expect(endSessionsMock).toHaveBeenCalledWith('u1');
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

  describe('on an account with MFA on', () => {
    beforeEach(() => {
      findUniqueMock.mockResolvedValue({ password: hash, mfa_enabled: true, email: 'me@example.com' });
    });

    it('rejects a password change without a code, after the current password is confirmed', async () => {
      const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw' }));
      expect(err.statusCode).toBe(400);
      expect((err as CredentialConfirmationError).field).toBe('mfa_code');
      expect(endSessionsMock).not.toHaveBeenCalled();
    });

    it('rejects an email change without a code', async () => {
      const err = await rejection(confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'current-pw' }));
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('email');
    });

    it('asks for the current password before the code', async () => {
      const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', mfaCode: '123456' }));
      expect((err as CredentialConfirmationError).field).toBe('current_password');
      expect(verifyMfaCodeMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid code with 403', async () => {
      verifyMfaCodeMock.mockResolvedValue(false);
      const err = await rejection(confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw', mfaCode: '000000' }));
      expect(err.statusCode).toBe(403);
      expect((err as CredentialConfirmationError).field).toBe('mfa_code');
    });

    it('maps an exhausted MFA budget to 429 on the code field', async () => {
      verifyMfaCodeMock.mockRejectedValue(new MfaRateLimitedError(7));
      const err = await rejection(confirmCredentialChange('u1', { email: 'other@example.com', currentPassword: 'current-pw', mfaCode: '1' }));
      expect(err.statusCode).toBe(429);
      expect(err.retryAfterSeconds).toBe(7);
    });

    it('accepts the change with a valid code and ends the other sessions', async () => {
      const out = await confirmCredentialChange('u1', { password: 'new-pw-123', currentPassword: 'current-pw', mfaCode: ' 123456 ' });
      expect(verifyMfaCodeMock).toHaveBeenCalledWith('u1', '123456');
      expect(await bcrypt.compare('new-pw-123', out.password)).toBe(true);
      expect(out.mfaEnabled).toBe(true);
      expect(endSessionsMock).toHaveBeenCalledTimes(1);
    });

    it('uses the code once when the same save also turns MFA off', async () => {
      const out = await confirmCredentialChange('u1', {
        password: 'new-pw-123', currentPassword: 'current-pw', mfaEnabled: false, mfaCode: '123456',
      });
      expect(disableMfaMock).toHaveBeenCalledWith('u1', '123456');
      expect(verifyMfaCodeMock).not.toHaveBeenCalled();
      expect(out.mfaEnabled).toBe(false);
    });

    it('asks for no code when neither the password nor the address changes', async () => {
      await confirmCredentialChange('u1', { password: '', email: 'me@example.com', mfaEnabled: true });
      expect(verifyMfaCodeMock).not.toHaveBeenCalled();
      expect(endSessionsMock).not.toHaveBeenCalled();
    });
  });
});

describe('credentialActionFailure', () => {
  it('names the field and message key of each refusal', () => {
    expect(credentialActionFailure(new CredentialConfirmationError(400, 'x', 'current_password'))).toMatchObject({
      ok: false, errorCode: 'VALIDATION', field: 'current_password', reason: 'missing', messageKey: 'Errors.currentPasswordRequired',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(403, 'x', 'current_password'))).toMatchObject({
      field: 'current_password', reason: 'invalid', messageKey: 'Errors.currentPasswordIncorrect',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(429, 'x', 'current_password'))).toMatchObject({
      messageKey: 'Errors.currentPasswordRateLimited',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(400, 'x', 'mfa_code'))).toMatchObject({
      field: 'mfa_code', reason: 'missing', messageKey: 'Errors.mfaCodeRequired',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(403, 'x', 'mfa_code'))).toMatchObject({
      field: 'mfa_code', messageKey: 'Errors.mfaCodeIncorrect',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(429, 'x', 'mfa_code'))).toMatchObject({
      field: 'mfa_code', messageKey: 'Errors.mfaCodeRateLimited',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(400, 'x', 'password'))).toMatchObject({
      field: 'password', messageKey: 'Errors.passwordTooWeak',
    });
    expect(credentialActionFailure(new CredentialConfirmationError(400, 'x', 'email'))).toMatchObject({
      errorCode: 'VALIDATION', field: 'email', reason: 'invalid', messageKey: 'Errors.emailDomainNotAllowed',
    });
  });

  it('treats a plain ApiError as a current password refusal', () => {
    expect(credentialActionFailure(new ApiError(403, 'x'))).toMatchObject({ field: 'current_password', messageKey: 'Errors.currentPasswordIncorrect' });
  });
});
