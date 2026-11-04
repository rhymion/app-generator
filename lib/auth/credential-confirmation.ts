import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { disableMfa } from '@/lib/mfa/enrollment';
import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { verifyPassword } from './password-check';
import { passwordPolicyError } from './password-policy';

// Same cost factor the app uses when it stores a password hash.
const BCRYPT_COST = 10;

export type CredentialChangeInput = {
  /** New password in plain text, as submitted by the caller. Empty or absent leaves the password unchanged. */
  password?: string | null;
  /** New email address as submitted by the caller. A value that differs from the stored address needs `currentPassword`. */
  email?: string | null;
  /** The account's current password. Required whenever `password` is supplied or `email` changes. */
  currentPassword?: unknown;
  /** Requested MFA state. Absent leaves it unchanged. */
  mfaEnabled?: boolean | null;
  /** A current TOTP or recovery code. Required to turn MFA off. */
  mfaCode?: unknown;
};

export type ConfirmedCredentialChange = {
  /** Hash to store, or '' when the password is not being changed. */
  password: string;
  /** The MFA state to store. */
  mfaEnabled: boolean;
};

/**
 * Confirms a password change, an email change or an MFA disable on the REST
 * write path with the same proof the account settings page asks for: the
 * current password to change the password or the email address, a current TOTP
 * or recovery code to turn MFA off. An API key or
 * mobile token alone is not enough to change either.
 *
 * Returns the values to hand to the service layer: the new password already
 * hashed, and the MFA state to store. Turning MFA off goes through
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

  let password = '';
  if (changesPassword || changesEmail) {
    const what = changesPassword ? 'the password' : 'the email address';
    if (typeof input.currentPassword !== 'string' || input.currentPassword === '') {
      throw new ApiError(400, `current_password is required to change ${what}`);
    }
    const decision = await getRateLimiter().check('auth:password:confirm', userId);
    if (!decision.allowed) {
      throw new ApiError(429, 'Too many attempts', decision.retryAfterSeconds);
    }
    // SSO-provisioned accounts have no password, so they fail like a wrong password.
    if (!(await verifyPassword(input.currentPassword, user.password))) {
      throw new ApiError(403, 'Current password is incorrect');
    }
    if (changesPassword) {
      const weak = passwordPolicyError(input.password);
      if (weak) throw new ApiError(400, weak);
    }
    if (changesPassword) password = await bcrypt.hash(input.password as string, BCRYPT_COST);
  }

  let mfaEnabled = user.mfa_enabled;
  if (typeof input.mfaEnabled === 'boolean' && input.mfaEnabled !== user.mfa_enabled) {
    if (input.mfaEnabled) {
      throw new ApiError(400, 'MFA can only be turned on through the enrollment flow on the settings page');
    }
    if (typeof input.mfaCode !== 'string' || input.mfaCode.trim() === '') {
      throw new ApiError(400, 'mfa_code is required to turn MFA off');
    }
    try {
      await disableMfa(userId, input.mfaCode.trim());
    } catch (err) {
      if (err instanceof MfaRateLimitedError) {
        throw new ApiError(429, 'Too many attempts', err.retryAfterSeconds);
      }
      if (err instanceof Error && err.message === 'Invalid MFA code') {
        throw new ApiError(403, 'Invalid MFA code');
      }
      throw err;
    }
    mfaEnabled = false;
  }

  return { password, mfaEnabled };
}
