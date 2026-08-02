'use server';

import { auth, unstable_update } from '@/auth';
import { verifyMfaCode } from '@/lib/mfa/verify';

export type ChallengeResult = { ok: true } | { ok: false; error: 'INVALID_CODE' | 'SESSION_REQUIRED' };

/**
 * Completes the post-first-factor MFA challenge (cmd_527). Called from
 * `/[locale]/mfa-challenge` after Google OAuth (or a version-bump on an
 * existing session) leaves `session.mfa_pending = true`.
 *
 * `verifyMfaCode` already falls back from TOTP to a recovery code
 * transparently (lib/mfa/verify.ts) — this one field accepts either, same
 * as the credentials login form's `mfa_code` field.
 */
export async function completeMfaChallenge(code: string): Promise<ChallengeResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'SESSION_REQUIRED' };
  if (!session.mfa_pending) return { ok: true }; // Already verified — no-op.

  const ok = await verifyMfaCode(session.user.id, code.trim());
  if (!ok) return { ok: false, error: 'INVALID_CODE' };

  await unstable_update({ mfa_pending: false });
  return { ok: true };
}
