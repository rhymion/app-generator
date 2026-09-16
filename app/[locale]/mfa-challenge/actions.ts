'use server';

import { auth, unstable_update } from '@/auth';
import { verifyMfaCode } from '@/lib/mfa/verify';
import { getRateLimiter } from '@/lib/rate-limit';

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
 * Rate-limited (Issue #588): unlike the credentials sign-in path, this
 * Server Action isn't reachable through proxy.ts's `/api/auth/*` matcher
 * (it's a normal page route), so it previously had zero protection against
 * a stolen-session attacker brute-forcing the TOTP/recovery code. Checked
 * against the `auth:mfa:challenge` bucket, keyed by the session's user id
 * (see lib/rate-limit/index.ts doc comment for why user id, not IP).
 */
export async function completeMfaChallenge(code: string): Promise<ChallengeResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'SESSION_REQUIRED' };
  if (!session.mfa_pending) return { ok: true }; // Already verified — no-op.

  const decision = await getRateLimiter().check('auth:mfa:challenge', session.user.id);
  if (!decision.allowed) {
    return { ok: false, error: 'RATE_LIMITED', retryAfterSeconds: decision.retryAfterSeconds };
  }

  const ok = await verifyMfaCode(session.user.id, code.trim());
  if (!ok) return { ok: false, error: 'INVALID_CODE' };

  await unstable_update({ mfa_pending: false });
  return { ok: true };
}
