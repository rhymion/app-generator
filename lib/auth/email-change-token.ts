/**
 * Email change link tokens (Issue #1400, docs/knowledge/authentication.md "Changing the email address").
 *
 * Same storage as the sign-up and password reset tokens (lib/auth/registration-token.ts): the
 * Auth.js `VerificationToken` table, `token` = SHA-256 of the random value in the link, `expires`
 * = 24 hours later. `identifier` is `email-change:<user id>:<new address>`, so the prefix keeps the
 * kinds apart (an email change link never finishes a sign-up or resets a password, and the other
 * links never change an address) and the row carries which account asked for which address.
 * Only the newest link of an account works, and a link works once.
 */
import { randomBytes } from 'node:crypto';
import type prisma from '@/lib/prisma';
import { hashRegistrationToken, normalizeEmail } from '@/lib/auth/registration-token';

/** How long an email change link stays usable. */
export const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const IDENTIFIER_PREFIX = 'email-change:';

type TokenStore = Pick<typeof prisma, 'verificationToken'>;

export type EmailChangeRequest = { userId: string; newEmail: string };

function userPrefix(userId: string): string {
  return `${IDENTIFIER_PREFIX}${userId}:`;
}

function parseIdentifier(identifier: string): EmailChangeRequest | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const rest = identifier.slice(IDENTIFIER_PREFIX.length);
  // A user id (cuid) has no colon, so the first one separates it from the address.
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { userId: rest.slice(0, sep), newEmail: rest.slice(sep + 1) };
}

/**
 * Creates a link token for `userId` to move to `newEmail`, replacing any earlier email change link
 * of that account, and returns the raw value for the link. The raw value is never stored.
 */
export async function issueEmailChangeToken(
  db: TokenStore,
  userId: string,
  newEmail: string,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await cancelEmailChange(db, userId);
  await db.verificationToken.create({
    data: {
      identifier: `${userPrefix(userId)}${normalizeEmail(newEmail)}`,
      token: hashRegistrationToken(token),
      expires: new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS),
    },
  });
  return token;
}

/** Removes any pending email change link of `userId`. */
export async function cancelEmailChange(db: TokenStore, userId: string): Promise<void> {
  await db.verificationToken.deleteMany({ where: { identifier: { startsWith: userPrefix(userId) } } });
}

/**
 * Uses up `token` and returns the account and the address it was issued for, or null when the token
 * is unknown, expired, of another kind or already used (not told apart). A conditional delete makes
 * only one of two concurrent calls succeed.
 */
export async function consumeEmailChangeToken(
  db: TokenStore,
  token: unknown,
  now = new Date(),
): Promise<EmailChangeRequest | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null;
  const hashed = hashRegistrationToken(token);
  const row = await db.verificationToken.findUnique({ where: { token: hashed } });
  const request = row ? parseIdentifier(row.identifier) : null;
  if (!request) return null;
  const removed = await db.verificationToken.deleteMany({ where: { token: hashed, expires: { gt: now } } });
  if (removed.count !== 1) {
    await db.verificationToken.deleteMany({ where: { token: hashed } });
    return null;
  }
  return request;
}
