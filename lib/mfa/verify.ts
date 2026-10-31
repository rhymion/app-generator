/**
 * Server-side MFA verification — used by the credentials authorize() path
 * and any future server action that re-confirms identity (e.g. "Disable
 * MFA" requires a fresh TOTP).
 *
 * Strategy:
 *
 *   1. Try the TOTP secret first. Recovery codes are scarce; TOTP is the
 *      common case and avoids a write.
 *   2. On TOTP failure, fall back to recovery codes. Each code matches at
 *      most one bcrypt-hashed row; on hit, mark `used_at` so it can't be
 *      replayed. We scan rows where `used_at IS NULL` only.
 *
 * Prisma model surface is typed via a narrow `MfaPrismaClient` cast for
 * the same reason `lib/audit-log.ts` uses one: the project's `Pick<typeof
 * prisma, '<model>'>` in generated services is too narrow to include the
 * MFA tables when they happen to be missing from a checkout's generated
 * client. The cast keeps `tsc` green; at runtime it throws clearly when
 * the schema hasn't been migrated.
 */
import prisma from '@/lib/prisma';
import { getRateLimiter } from '@/lib/rate-limit';
import { decryptSecret } from './crypto';
import { MfaRateLimitedError } from './errors';
import { verifyRecoveryCode } from './recovery';
import { verifyTotpStep } from './totp';

type MfaUser = { id: string; mfa_secret: string | null; mfa_enabled: boolean; mfa_last_totp_step: number | null };
type MfaRecoveryRow = { id: string; code_hash: string };
type MfaPrismaClient = {
  user: {
    findUnique: (args: { where: { id: string }; select: { id: true; mfa_secret: true; mfa_enabled: true; mfa_last_totp_step: true } }) => Promise<MfaUser | null>;
    updateMany: (args: {
      where: { id: string; OR: Array<{ mfa_last_totp_step: null } | { mfa_last_totp_step: { lt: number } }> };
      data: { mfa_last_totp_step: number };
    }) => Promise<{ count: number }>;
  };
  mfa_recovery_code: {
    findMany: (args: { where: { user_id: string; used_at: null }; select: { id: true; code_hash: true } }) => Promise<MfaRecoveryRow[]>;
    updateMany: (args: { where: { id: string; used_at: null }; data: { used_at: Date } }) => Promise<{ count: number }>;
  };
};

function client(): MfaPrismaClient {
  return prisma as unknown as MfaPrismaClient;
}

/**
 * True iff `code` is a currently-valid TOTP or an unused recovery code for `userId`.
 *
 * Every call spends one attempt from the `auth:mfa:challenge` bucket (keyed by
 * user id), so every caller — web sign-in, the challenge action, the mobile
 * token route, enrollment — shares one budget. Throws `MfaRateLimitedError`
 * once it is spent, before any guess is evaluated.
 */
export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const decision = await getRateLimiter().check('auth:mfa:challenge', userId);
  if (!decision.allowed) throw new MfaRateLimitedError(decision.retryAfterSeconds);

  const user = await client().user.findUnique({
    where: { id: userId },
    select: { id: true, mfa_secret: true, mfa_enabled: true, mfa_last_totp_step: true },
  });
  if (!user || !user.mfa_enabled || !user.mfa_secret) return false;

  const secret = decryptSecret(user.mfa_secret);
  // A code from a step at or before the last accepted one is refused, and the step is claimed with a
  // conditional write so two concurrent requests presenting the same code cannot both succeed.
  const step = await verifyTotpStep(secret, code, user.mfa_last_totp_step);
  if (step !== null) {
    const claimed = await client().user.updateMany({
      where: { id: userId, OR: [{ mfa_last_totp_step: null }, { mfa_last_totp_step: { lt: step } }] },
      data: { mfa_last_totp_step: step },
    });
    return claimed.count === 1;
  }

  // Recovery code fallback. Single-use: the first matching row gets `used_at` stamped
  // by a conditional write (only while it is still null) before we return true, so a
  // winning code can't replay, even from a concurrent request.
  const candidates = await client().mfa_recovery_code.findMany({
    where: { user_id: userId, used_at: null },
    select: { id: true, code_hash: true },
  });
  for (const row of candidates) {
    if (await verifyRecoveryCode(code, row.code_hash)) {
      const used = await client().mfa_recovery_code.updateMany({
        where: { id: row.id, used_at: null },
        data: { used_at: new Date() },
      });
      return used.count === 1;
    }
  }
  return false;
}
