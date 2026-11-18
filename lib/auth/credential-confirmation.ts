import { hashPassword } from './bcrypt-cost';
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { disableMfa } from '@/lib/mfa/enrollment';
import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { verifyPassword } from './password-check';
import { passwordPolicyError } from './password-policy';
import { verifyMfaCode } from '@/lib/mfa/verify';
import type { ActionFailure } from '@/lib/_errors';
import { emailChangeNeedsVerification, startEmailChange } from './email-change';
import { endSessionsAfterChange } from './end-sessions';

/** The form field a refusal is about, for the settings screen's Server Action. */
export type CredentialField = 'current_password' | 'mfa_code' | 'password';

/**
 * A refused credential change. An `ApiError` (so the REST routes answer its status as before) that
 * also names the field it is about, so the settings screen can show the message next to it.
 */
export class CredentialConfirmationError extends ApiError {
  constructor(
    statusCode: number,
    message: string,
    public readonly field: CredentialField,
    retryAfterSeconds?: number,
  ) {
    super(statusCode, message, retryAfterSeconds);
  }
}

/**
 * The Server Action's answer to a refused change (`upsertSetting` in the generated
 * lib/setting/actions.ts): a VALIDATION failure on the field the refusal is about.
 */
export function credentialActionFailure(e: ApiError): ActionFailure {
  const field: CredentialField = e instanceof CredentialConfirmationError ? e.field : 'current_password';
  const status = e.statusCode;
  if (field === 'password') {
    return { ok: false, errorCode: 'VALIDATION', field, reason: 'invalid', messageKey: 'Errors.passwordTooWeak' };
  }
  const prefix = field === 'mfa_code' ? 'Errors.mfaCode' : 'Errors.currentPassword';
  return {
    ok: false,
    errorCode: 'VALIDATION',
    field,
    reason: status === 400 ? 'missing' : 'invalid',
    messageKey: `${prefix}${status === 400 ? 'Required' : status === 429 ? 'RateLimited' : 'Incorrect'}`,
  };
}

export type CredentialChangeInput = {
  /** New password in plain text, as submitted by the caller. Empty or absent leaves the password unchanged. */
  password?: string | null;
  /** New email address as submitted by the caller. A value that differs from the stored address needs `currentPassword`. */
  email?: string | null;
  /** The account's current password. Required whenever `password` is supplied or `email` changes. */
  currentPassword?: unknown;
  /** Requested MFA state. Absent leaves it unchanged. */
  mfaEnabled?: boolean | null;
  /**
   * A current TOTP or recovery code. Required to turn MFA off, and, on an account with MFA on, to
   * change the password or the email address.
   */
  mfaCode?: unknown;
};

export type ConfirmedCredentialChange = {
  /** Hash to store, or '' when the password is not being changed. */
  password: string;
  /** The MFA state to store. */
  mfaEnabled: boolean;
  /**
   * The email address to store. The submitted value, except while a changed address waits for its
   * verification link (email verification on, Issue #1400): then the current address, unchanged.
   */
  email: string;
};

/**
 * Confirms a password change, an email change or an MFA disable on the REST
 * write path with the same proof the account settings page asks for: the
 * current password to change the password or the email address, a current TOTP
 * or recovery code to turn MFA off. An API key or
 * mobile token alone is not enough to change either.
 *
 * Returns the values to hand to the service layer: the new password already
 * hashed, the MFA state to store and the email address to store. With email
 * verification on, a changed address is not stored here: the new address gets
 * a single-use link and the current one stays until the link is used
 * (lib/auth/email-change.ts, Issue #1400). Turning MFA off goes through
 * `disableMfa`, which also clears the secret and the recovery codes, exactly as
 * the settings page does. Turning MFA on is rejected because it needs the
 * enrollment flow (secret, QR code, first code) on the settings page.
 */
export async function confirmCredentialChange(
  userId: string,
  input: CredentialChangeInput,
): Promise<ConfirmedCredentialChange> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true, mfa_enabled: true, email: true },
  });
  if (!user) throw new ApiError(404, 'Not found');

  const changesPassword = typeof input.password === 'string' && input.password !== '';
  const changesEmail =
    typeof input.email === 'string' &&
    input.email.trim().toLowerCase() !== (user.email ?? '').trim().toLowerCase();
  const turnsMfaOff = typeof input.mfaEnabled === 'boolean' && !input.mfaEnabled && user.mfa_enabled;

  if (typeof input.mfaEnabled === 'boolean' && input.mfaEnabled && !user.mfa_enabled) {
    throw new ApiError(400, 'MFA can only be turned on through the enrollment flow on the settings page');
  }

  let password = '';
  if (changesPassword || changesEmail) {
    const what = changesPassword ? 'the password' : 'the email address';
    if (typeof input.currentPassword !== 'string' || input.currentPassword === '') {
      throw new CredentialConfirmationError(400, `current_password is required to change ${what}`, 'current_password');
    }
    const decision = await getRateLimiter().check('auth:password:confirm', userId);
    if (!decision.allowed) {
      throw new CredentialConfirmationError(429, 'Too many attempts', 'current_password', decision.retryAfterSeconds);
    }
    // SSO-provisioned accounts have no password, so they fail like a wrong password.
    if (!(await verifyPassword(input.currentPassword, user.password))) {
      throw new CredentialConfirmationError(403, 'Current password is incorrect', 'current_password');
    }
    if (changesPassword) {
      const weak = passwordPolicyError(input.password);
      if (weak) throw new CredentialConfirmationError(400, weak, 'password');
    }
  }

  // An account with MFA on proves the second factor too before its password or address changes.
  // When the same request turns MFA off, disableMfa() below checks the code, so it is used once.
  const mfaCode = typeof input.mfaCode === 'string' ? input.mfaCode.trim() : '';
  if ((changesPassword || changesEmail || turnsMfaOff) && user.mfa_enabled) {
    if (!mfaCode) {
      const why = turnsMfaOff ? 'to turn MFA off' : `to change ${changesPassword ? 'the password' : 'the email address'} while MFA is on`;
      throw new CredentialConfirmationError(400, `mfa_code is required ${why}`, 'mfa_code');
    }
    try {
      if (turnsMfaOff) {
        await disableMfa(userId, mfaCode);
      } else if (!(await verifyMfaCode(userId, mfaCode))) {
        throw new Error('Invalid MFA code');
      }
    } catch (err) {
      if (err instanceof MfaRateLimitedError) {
        throw new CredentialConfirmationError(429, 'Too many attempts', 'mfa_code', err.retryAfterSeconds);
      }
      if (err instanceof Error && err.message === 'Invalid MFA code') {
        throw new CredentialConfirmationError(403, 'Invalid MFA code', 'mfa_code');
      }
      throw err;
    }
  }
  if (changesPassword) password = await hashPassword(input.password as string);
  const mfaEnabled = turnsMfaOff ? false : user.mfa_enabled;

  // Issue #1400: last, once every other check has passed, so a refused save sends no mail.
  let email = input.email as string;
  const emailPending = changesEmail && emailChangeNeedsVerification();
  if (emailPending) {
    await startEmailChange({ userId, currentEmail: user.email, newEmail: input.email as string });
    email = user.email;
  }

  // A changed password, a stored new address or MFA turned off ends the user's other sessions:
  // a session opened with the old credential must not outlive the change. A pending address change
  // ends them when its link is used (completeEmailChange()).
  if (changesPassword || turnsMfaOff || (changesEmail && !emailPending)) {
    await endSessionsAfterChange(userId);
  }

  return { password, mfaEnabled, email };
}
