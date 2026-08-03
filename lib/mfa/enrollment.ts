/**
 * MFA enrollment / disable lifecycle.
 *
 * State machine (all transitions guarded by the credentials session):
 *
 *     disabled ─ startEnrollment ──▶ pending  (secret encrypted in user.mfa_secret,
 *                                              user.mfa_enabled = false)
 *     pending  ─ completeEnrollment ▶ enabled (mfa_enabled = true, fresh
 *                                              mfa_recovery_code rows; plaintext
 *                                              recovery codes returned ONCE)
 *     enabled  ─ disableMfa ────────▶ disabled (mfa_secret cleared,
 *                                              recovery codes deleted)
 *
 * Why park the pending secret in `user.mfa_secret` rather than a session
 * cookie: the encrypted secret is already meaningless until `mfa_enabled`
 * flips true, so leaking it from the browser would buy an attacker
 * nothing. Keeping the only copy server-side also means the user can
 * resume enrollment from a different tab if the first one closes.
 *
 * Prisma is reached via a narrow cast (same pattern as
 * `lib/mfa/verify.ts` and `lib/audit-log.ts`) so `tsc` stays clean even
 * when a checkout's generated client predates the MFA fields.
 */
import prisma from '@/lib/prisma';
import { decryptSecret, encryptSecret } from './crypto';
import { generateRecoveryCodes } from './recovery';
import { verifyTotp, otpauthQrDataUrl, generateSecret } from './totp';

type MfaUserSelect = {
  id: string;
  email: string;
  mfa_secret: string | null;
  mfa_enabled: boolean;
};
type MfaPrismaClient = {
  user: {
    findUnique: (args: { where: { id: string }; select: { id: true; email: true; mfa_secret: true; mfa_enabled: true } }) => Promise<MfaUserSelect | null>;
    update: (args: { where: { id: string }; data: Partial<{ mfa_secret: string | null; mfa_enabled: boolean; mfa_token_version: { increment: number } }> }) => Promise<unknown>;
  };
  mfa_recovery_code: {
    deleteMany: (args: { where: { user_id: string } }) => Promise<unknown>;
    createMany: (args: { data: Array<{ user_id: string; code_hash: string }> }) => Promise<unknown>;
  };
};

function db(): MfaPrismaClient {
  return prisma as unknown as MfaPrismaClient;
}

export type EnrollmentStatus =
  | { state: 'disabled' }
  | { state: 'pending'; qrDataUrl: string; secret: string }
  | { state: 'enabled' };

export async function getEnrollmentStatus(userId: string): Promise<EnrollmentStatus> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mfa_secret: true, mfa_enabled: true },
  });
  if (!user) return { state: 'disabled' };
  if (user.mfa_enabled) return { state: 'enabled' };
  if (user.mfa_secret) {
    // Resume the pending enrollment.
    const secret = decryptSecret(user.mfa_secret);
    return {
      state: 'pending',
      secret,
      qrDataUrl: await otpauthQrDataUrl(secret, user.email),
    };
  }
  return { state: 'disabled' };
}

/** Generate a fresh TOTP secret and stash it as pending. Returns the secret
 *  + QR data URL so the page can render them. Overwrites any prior pending
 *  enrollment for this user (fine — secrets are stateless). */
export async function startEnrollment(userId: string): Promise<{ secret: string; qrDataUrl: string }> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mfa_secret: true, mfa_enabled: true },
  });
  if (!user) throw new Error('User not found');
  if (user.mfa_enabled) throw new Error('MFA already enabled');

  const secret = generateSecret();
  await db().user.update({
    where: { id: userId },
    data: { mfa_secret: encryptSecret(secret) },
  });
  const qrDataUrl = await otpauthQrDataUrl(secret, user.email);
  return { secret, qrDataUrl };
}

/** Verify the user's first TOTP code; on success flip `mfa_enabled=true`
 *  and write fresh recovery codes (deletes any from a prior cycle).
 *  Returns the plaintext codes ONCE for display. */
export async function completeEnrollment(
  userId: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mfa_secret: true, mfa_enabled: true },
  });
  if (!user) throw new Error('User not found');
  if (user.mfa_enabled) throw new Error('MFA already enabled');
  if (!user.mfa_secret) throw new Error('No pending enrollment');

  const secret = decryptSecret(user.mfa_secret);
  const ok = await verifyTotp(secret, code);
  if (!ok) throw new Error('Invalid MFA code');

  const codes = await generateRecoveryCodes();
  // Wipe-and-reinsert: simpler than diff. Recovery codes are short-lived
  // by design (regenerated on re-enrolment), so we don't need stable ids.
  await db().mfa_recovery_code.deleteMany({ where: { user_id: userId } });
  await db().mfa_recovery_code.createMany({
    data: codes.map((c) => ({ user_id: userId, code_hash: c.hash })),
  });
  // mfa_token_version increments here (not on disable/regenerate): this is
  // the transition that creates the session-persistence gap (cmd_527 §4.3)
  // — an already-active JWT minted before MFA was enabled must be forced
  // to re-verify, not just future sign-ins.
  await db().user.update({
    where: { id: userId },
    data: { mfa_enabled: true, mfa_token_version: { increment: 1 } },
  });
  return { recoveryCodes: codes.map((c) => c.plaintext) };
}

/** Turn MFA off. Requires a current TOTP (or recovery) code so an
 *  attacker with a stolen session cookie can't disable the second
 *  factor. Verification is delegated to `verifyMfaCode` so recovery
 *  codes work here too. */
export async function disableMfa(userId: string, code: string): Promise<void> {
  const { verifyMfaCode } = await import('./verify');
  const ok = await verifyMfaCode(userId, code);
  if (!ok) throw new Error('Invalid MFA code');

  await db().mfa_recovery_code.deleteMany({ where: { user_id: userId } });
  await db().user.update({
    where: { id: userId },
    data: { mfa_secret: null, mfa_enabled: false },
  });
}

/** Re-issue fresh recovery codes for an already-enabled MFA account.
 *  Requires a current TOTP or recovery code. Old codes are deleted
 *  atomically before the new ones are written. Returns the new plaintext
 *  codes ONCE — callers must display and then discard them. */
export async function regenerateRecoveryCodes(
  userId: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mfa_secret: true, mfa_enabled: true },
  });
  if (!user) throw new Error('User not found');
  if (!user.mfa_enabled) throw new Error('MFA_NOT_ENABLED');

  const { verifyMfaCode } = await import('./verify');
  const ok = await verifyMfaCode(userId, code);
  if (!ok) throw new Error('INVALID_CODE');

  const codes = await generateRecoveryCodes();
  await db().mfa_recovery_code.deleteMany({ where: { user_id: userId } });
  await db().mfa_recovery_code.createMany({
    data: codes.map((c) => ({ user_id: userId, code_hash: c.hash })),
  });
  return { recoveryCodes: codes.map((c) => c.plaintext) };
}
