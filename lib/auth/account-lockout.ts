import { createHash } from 'node:crypto';

import { recordAuditEvent } from '@/lib/audit-log';
import { getRateLimiter } from '@/lib/rate-limit';

/**
 * Per-account lockout after repeated failed password sign-ins (Issue #1125).
 *
 * The per-IP bucket (`auth:signin:credentials`) cannot stop one account being
 * guessed from many addresses. This counter is keyed by the account's email
 * instead, counts only failures, and refuses further password attempts for
 * that account while the failure budget of the `auth:account:lockout` bucket
 * is spent (10 failures in 15 minutes by default, see `lib/rate-limit`). The
 * lock lifts by itself once the oldest counted failure leaves the window; no
 * database column is involved, so the state lives in the same store as the
 * other rate limits (Redis when `REDIS_URL` is set, per process otherwise).
 *
 * The key is derived from the submitted email whether or not an account
 * exists, so a locked response never reveals which emails are registered. The
 * email is hashed so the store never holds it in clear.
 */
export const ACCOUNT_LOCKOUT_BUCKET = 'auth:account:lockout';

function lockoutKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Result of asking whether an account may attempt a password sign-in now. */
export type AccountLockState = { locked: boolean; retryAfterSeconds: number };

export async function getAccountLockState(email: string): Promise<AccountLockState> {
  const decision = await getRateLimiter().peek(ACCOUNT_LOCKOUT_BUCKET, lockoutKey(email));
  return { locked: !decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
}

/** Count one failed password attempt; audits the attempt that locks the account. */
export async function recordFailedSignIn(email: string): Promise<void> {
  const key = lockoutKey(email);
  const decision = await getRateLimiter().check(ACCOUNT_LOCKOUT_BUCKET, key);
  if (decision.allowed && decision.remaining === 0) {
    await recordAuditEvent({
      action: 'auth:account.locked',
      metadata: { reason: 'failed_sign_in_threshold', account_key: key.slice(0, 16) },
    });
  }
}

/** Forget the failure count after a successful sign-in. */
export async function clearFailedSignIns(email: string): Promise<void> {
  await getRateLimiter().reset(ACCOUNT_LOCKOUT_BUCKET, lockoutKey(email));
}
