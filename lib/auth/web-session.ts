/**
 * Server-side revocation of web (Auth.js) sessions (Issue #1127, docs/knowledge/authentication.md
 * "Server-side session revocation").
 *
 * The web session stays a signed JWT cookie (`session.strategy = "jwt"`, see auth.ts). Each sign-in
 * also writes a `web_session` row and stamps its id into the token as `sid`. Every session read in
 * auth.ts's jwt() callback loads the row in the same query that already reads the user (a joined
 * relation, one database round trip), and a token whose row is gone is no session: Auth.js clears
 * the cookie. So deleting a row revokes one session and deleting a user's rows signs the user out
 * on every browser.
 *
 * `expires_at` only decides when an unused row is purged. A row is created to outlive the cookie
 * by one refresh interval (`maxAge + updateAge`) and pushed forward again once less than `maxAge`
 * is left, which an active session reaches at most once per `updateAge` (default once a day). The
 * cookie's own expiry and the absolute lifetime (lib/session-policy.ts) still end the session.
 */
import prisma from '@/lib/prisma';

type Db = Pick<typeof prisma, 'web_session'>;

export type WebSessionPolicy = { maxAge: number; updateAge: number };

/** When a row created or extended at `now` may be purged. */
export function webSessionExpiry(policy: WebSessionPolicy, now: Date = new Date()): Date {
  return new Date(now.getTime() + (policy.maxAge + policy.updateAge) * 1000);
}

/** True once a row has less than `maxAge` left, so the next extension is due. */
export function webSessionNeedsExtension(expiresAt: Date, policy: WebSessionPolicy, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < policy.maxAge * 1000;
}

/**
 * Records a new session of `userId` and returns its id for the token's `sid`. The user's expired
 * rows are removed on the way, so the rows of anyone who keeps signing in stay bounded without a
 * scheduled job; `purgeExpiredWebSessions()` clears the rest.
 */
export async function createWebSession(userId: string, policy: WebSessionPolicy, db: Db = prisma): Promise<string> {
  await db.web_session.deleteMany({ where: { user_id: userId, expires_at: { lt: new Date() } } });
  const row = await db.web_session.create({
    data: { user_id: userId, expires_at: webSessionExpiry(policy) },
    select: { id: true },
  });
  return row.id;
}

/** Pushes the purge time of a session forward. A revoked (missing) row stays missing. */
export async function extendWebSession(sessionId: string, policy: WebSessionPolicy, db: Db = prisma): Promise<void> {
  await db.web_session.updateMany({ where: { id: sessionId }, data: { expires_at: webSessionExpiry(policy) } });
}

/** Ends one session: its next request is unauthenticated. Returns whether a session was ended. */
export async function revokeWebSession(sessionId: string, db: Db = prisma): Promise<boolean> {
  const { count } = await db.web_session.deleteMany({ where: { id: sessionId } });
  return count > 0;
}

/**
 * Ends every web session of `userId`, or every one but `exceptSessionId` (for example the session
 * that asked to sign out the other devices). Returns how many were ended.
 */
export async function revokeUserWebSessions(
  userId: string,
  options: { exceptSessionId?: string } = {},
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.web_session.deleteMany({
    where: { user_id: userId, ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}) },
  });
  return count;
}

/** Deletes rows whose session can no longer be in use. Returns how many were deleted. */
export async function purgeExpiredWebSessions(now: Date = new Date(), db: Db = prisma): Promise<number> {
  const { count } = await db.web_session.deleteMany({ where: { expires_at: { lt: now } } });
  return count;
}

type SessionsDb = Pick<typeof prisma, 'web_session' | 'mobile_session'>;

/**
 * Ends every session of `userId` except the ones that made the request: the web sessions but
 * `keep.webSessionId` and the mobile sessions (revoked, as on sign-out) but `keep.mobileSessionId`.
 * Called when the password, the email address or the MFA state changes, so a session opened by
 * someone who knew the old credential does not outlive the change. Returns how many web and mobile
 * sessions were ended.
 */
export async function endOtherSessions(
  userId: string,
  keep: { webSessionId?: string; mobileSessionId?: string } = {},
  db: SessionsDb = prisma,
): Promise<{ web: number; mobile: number }> {
  const web = await revokeUserWebSessions(userId, { exceptSessionId: keep.webSessionId }, db);
  const { count: mobile } = await db.mobile_session.updateMany({
    where: {
      user_id: userId,
      revoked_at: null,
      ...(keep.mobileSessionId ? { id: { not: keep.mobileSessionId } } : {}),
    },
    data: { revoked_at: new Date() },
  });
  return { web, mobile };
}
