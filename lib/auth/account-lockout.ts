import { createHash } from 'node:crypto';

import { recordAuditEvent } from '@/lib/audit-log';
import { getRateLimiter } from '@/lib/rate-limit';
import { clientIp } from '@/lib/rate-limit/client-ip';

/**
 * Two-tier account lockout after repeated failed password sign-ins (Issue #1125).
 *
 * Tier 1 (`auth:account:lockout`) is keyed by the normalised email AND the
 * source address. Ten failures in 15 minutes lock password sign-in for that
 * email from that address only, so someone who merely knows an email cannot
 * keep its owner out by failing from elsewhere: the owner's own address has its
 * own counter. The address is derived by `clientIp()`, the same function the
 * per-IP limits in `proxy.ts` use.
 *
 * Tier 2 (`auth:account:lockout:email`) is keyed by the email alone and has a
 * much higher ceiling. It stops guessing spread across many addresses, and it
 * is what still holds when an attacker can make `clientIp()` return a different
 * value per request (a spoofable header makes every tier-1 key unique). Once it
 * is spent the account refuses password sign-in from every address until the
 * window passes.
 *
 * Both tiers count failures only and lift by themselves when the oldest counted
 * failure leaves the window. No database column is involved: the state lives in
 * the rate-limit store (Redis when `REDIS_URL` is set, per process otherwise).
 *
 * Keys are derived from the submitted email whether or not an account exists, so
 * a locked response never reveals which emails are registered. Emails and
 * addresses are hashed, so the store never holds them in clear.
 */
export const ACCOUNT_LOCKOUT_BUCKET = 'auth:account:lockout';
export const ACCOUNT_LOCKOUT_EMAIL_BUCKET = 'auth:account:lockout:email';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emailKey(email: string): string {
  return sha256(email.trim().toLowerCase());
}

function emailIpKey(email: string, headers: Headers): string {
  return sha256(`${emailKey(email)}|${clientIp(headers)}`);
}

/** Result of asking whether an account may attempt a password sign-in now. */
export type AccountLockState = { locked: boolean; retryAfterSeconds: number };

export async function getAccountLockState(email: string, headers: Headers): Promise<AccountLockState> {
  const limiter = getRateLimiter();
  const [perAddress, perEmail] = await Promise.all([
    limiter.peek(ACCOUNT_LOCKOUT_BUCKET, emailIpKey(email, headers)),
    limiter.peek(ACCOUNT_LOCKOUT_EMAIL_BUCKET, emailKey(email)),
  ]);
  const locked = !perAddress.allowed || !perEmail.allowed;
  return {
    locked,
    retryAfterSeconds: Math.max(perAddress.retryAfterSeconds, perEmail.retryAfterSeconds),
  };
}

/** Count one failed password attempt in both tiers; audits the attempt that locks a tier. */
export async function recordFailedSignIn(email: string, headers: Headers): Promise<void> {
  const limiter = getRateLimiter();
  const key = emailKey(email);
  const [perAddress, perEmail] = await Promise.all([
    limiter.check(ACCOUNT_LOCKOUT_BUCKET, emailIpKey(email, headers)),
    limiter.check(ACCOUNT_LOCKOUT_EMAIL_BUCKET, key),
  ]);
  const lockedTier = perAddress.allowed && perAddress.remaining === 0
    ? 'email_and_address'
    : perEmail.allowed && perEmail.remaining === 0
      ? 'email'
      : null;
  if (lockedTier) {
    await recordAuditEvent({
      action: 'auth:account.locked',
      metadata: { reason: 'failed_sign_in_threshold', tier: lockedTier, account_key: key.slice(0, 16) },
    });
  }
}

/**
 * Forget the failures of this email after a successful sign-in: the count for
 * this address (tier 1) and the email-wide count (tier 2). A correct password
 * ends the guessing that the counters measure, and keeping the email-wide count
 * would let a few mistypes spread over the owner's devices lock the owner out
 * later in the same window.
 */
export async function clearFailedSignIns(email: string, headers: Headers): Promise<void> {
  const limiter = getRateLimiter();
  await Promise.all([
    limiter.reset(ACCOUNT_LOCKOUT_BUCKET, emailIpKey(email, headers)),
    limiter.reset(ACCOUNT_LOCKOUT_EMAIL_BUCKET, emailKey(email)),
  ]);
}
