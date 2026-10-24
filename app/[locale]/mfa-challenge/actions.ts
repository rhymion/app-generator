'use server';

import { auth, unstable_update } from '@/auth';
import { verifyMfaCode } from '@/lib/mfa/verify';
import { MfaRateLimitedError } from '@/lib/mfa/errors';

export type ChallengeResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_CODE' | 'SESSION_REQUIRED' | 'RATE_LIMITED'; retryAfterSeconds?: number };

/**
 * Completes the post-first-factor MFA challenge (cmd_527). Called from
 * `/[locale]/mfa-challenge` after Google OAuth (or a version-bump on an
 * existing session) leaves `session.mfa_pending = true`.
 *
 * `verifyMfaCode` already falls back from TOTP to a recovery code
 * transparently (lib/mfa/verify.ts) — this one field accepts either, same
 * as the credentials login form's `mfa_code` field.
 *
 * Rate-limited (Issue #588): this Server Action isn't reachable through
 * proxy.ts's `/api/auth/*` matcher (it's a normal page route). The
 * `auth:mfa:challenge` bucket, keyed by the session's user id (see
 * lib/rate-limit/index.ts for why user id, not IP), is enforced inside
 * `verifyMfaCode` itself, which throws `MfaRateLimitedError` once spent.
 */
export async function completeMfaChallenge(code: string): Promise<ChallengeResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'SESSION_REQUIRED' };
  if (!session.mfa_pending) return { ok: true }; // Already verified — no-op.

  let ok: boolean;
  try {
    ok = await verifyMfaCode(session.user.id, code.trim());
  } catch (e) {
    if (e instanceof MfaRateLimitedError) {
      return { ok: false, error: 'RATE_LIMITED', retryAfterSeconds: e.retryAfterSeconds };
    }
    throw e;
  }
  if (!ok) return { ok: false, error: 'INVALID_CODE' };

  await unstable_update({ mfa_pending: false });
  return { ok: true };
}
