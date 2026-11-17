/**
 * Password reset link tokens (Issue #1282, docs/knowledge/authentication.md "Password reset").
 *
 * Same storage as the sign-up tokens (lib/auth/registration-token.ts): the Auth.js
 * `VerificationToken` table, `identifier` = `password-reset:<email>`, `token` = SHA-256 of
 * the random value in the link, `expires` = one hour later. The prefixes keep the two kinds
 * apart: a reset link never finishes a sign-up and a sign-up link never resets a password.
 * Only the newest link for an address works, and a link works once.
 */
import { randomBytes } from 'node:crypto';
import type prisma from '@/lib/prisma';
import { hashRegistrationToken, normalizeEmail } from '@/lib/auth/registration-token';

/** How long a reset link stays usable. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const IDENTIFIER_PREFIX = 'password-reset:';

type TokenStore = Pick<typeof prisma, 'verificationToken'>;

function validShape(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 256;
}

/** Creates a new link token for `email`, replacing any earlier one; returns the raw value. */
export async function issuePasswordResetToken(db: TokenStore, email: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const identifier = `${IDENTIFIER_PREFIX}${normalizeEmail(email)}`;
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token: hashRegistrationToken(token),
      expires: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    },
  });
  return token;
}

/**
 * The email a still-valid reset token was issued for, without using the token up, or null.
 * The complete route reads it first so that a wrong second-factor code does not burn the link.
 */
export async function peekPasswordResetToken(db: TokenStore, token: unknown, now = new Date()): Promise<string | null> {
  if (!validShape(token)) return null;
  const row = await db.verificationToken.findUnique({ where: { token: hashRegistrationToken(token) } });
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX) || row.expires <= now) return null;
  return row.identifier.slice(IDENTIFIER_PREFIX.length);
}

/**
 * Uses up `token` and returns its email, or null when it is unknown, expired, of the other
 * kind or already used. A conditional delete makes only one of two concurrent calls succeed.
 */
export async function consumePasswordResetToken(db: TokenStore, token: unknown, now = new Date()): Promise<string | null> {
  if (!validShape(token)) return null;
  const hashed = hashRegistrationToken(token);
  const row = await db.verificationToken.findUnique({ where: { token: hashed } });
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const removed = await db.verificationToken.deleteMany({ where: { token: hashed, expires: { gt: now } } });
  if (removed.count !== 1) {
    await db.verificationToken.deleteMany({ where: { token: hashed } });
    return null;
  }
  return row.identifier.slice(IDENTIFIER_PREFIX.length);
}
