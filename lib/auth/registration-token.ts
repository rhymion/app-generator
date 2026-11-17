/**
 * Sign-up confirmation tokens for self-registration with email verification
 * (Issue #1092, docs/knowledge/authentication.md "Self-registration").
 *
 * Stored in the Auth.js `VerificationToken` table, which the app otherwise does
 * not use: `identifier` is `registration:<email>`, `token` is the SHA-256 of the
 * random value sent in the link (a database read cannot replay a link) and
 * `expires` ends the link's life. Only the newest link for an address works,
 * and a link works once.
 */
import { createHash, randomBytes } from 'node:crypto';
import type prisma from '@/lib/prisma';

/** How long a confirmation link stays usable. */
export const REGISTRATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const IDENTIFIER_PREFIX = 'registration:';

/** The client or a transaction of it (the complete route consumes inside one). */
type TokenStore = Pick<typeof prisma, 'verificationToken'>;

/**
 * Trims surrounding whitespace only. Case is kept: sign-in (auth.ts) and the
 * one-step registration look the address up exactly as typed, so lower-casing
 * here would create an account its owner cannot sign in to.
 */
export function normalizeEmail(email: string): string {
  return email.trim();
}

function identifierFor(email: string): string {
  return `${IDENTIFIER_PREFIX}${normalizeEmail(email)}`;
}

export function hashRegistrationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Creates a new link token for `email`, replacing any earlier one, and returns
 * the raw value for the link. The raw value is never stored.
 */
export async function issueRegistrationToken(db: TokenStore, email: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const identifier = identifierFor(email);
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token: hashRegistrationToken(token),
      expires: new Date(now.getTime() + REGISTRATION_TOKEN_TTL_MS),
    },
  });
  return token;
}

/**
 * Uses up `token` and returns the email it was issued for, or null when the
 * token is unknown, expired or already used (the three are not told apart).
 * The row is removed by a conditional delete, so of two concurrent calls with
 * the same token only one gets the email.
 */
export async function consumeRegistrationToken(db: TokenStore, token: string, now = new Date()): Promise<string | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null;
  const hashed = hashRegistrationToken(token);
  const row = await db.verificationToken.findUnique({ where: { token: hashed } });
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const removed = await db.verificationToken.deleteMany({ where: { token: hashed, expires: { gt: now } } });
  if (removed.count !== 1) {
    // Expired: clear it so the table does not keep dead rows.
    await db.verificationToken.deleteMany({ where: { token: hashed } });
    return null;
  }
  return row.identifier.slice(IDENTIFIER_PREFIX.length);
}
