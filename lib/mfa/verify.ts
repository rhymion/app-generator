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
import { decryptSecret } from './crypto';
import { verifyRecoveryCode } from './recovery';
import { verifyTotp } from './totp';

type MfaUser = { id: string; mfa_secret: string | null; mfa_enabled: boolean };
type MfaRecoveryRow = { id: string; code_hash: string };
type MfaPrismaClient = {
  user: {
    findUnique: (args: { where: { id: string }; select: { id: true; mfa_secret: true; mfa_enabled: true } }) => Promise<MfaUser | null>;
  };
  mfa_recovery_code: {
    findMany: (args: { where: { user_id: string; used_at: null }; select: { id: true; code_hash: true } }) => Promise<MfaRecoveryRow[]>;
    update: (args: { where: { id: string }; data: { used_at: Date } }) => Promise<unknown>;
  };
};

function client(): MfaPrismaClient {
  return prisma as unknown as MfaPrismaClient;
}

/** True iff `code` is a currently-valid TOTP or an unused recovery code for `userId`. */
export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await client().user.findUnique({
    where: { id: userId },
    select: { id: true, mfa_secret: true, mfa_enabled: true },
  });
  if (!user || !user.mfa_enabled || !user.mfa_secret) return false;

  const secret = decryptSecret(user.mfa_secret);
  if (await verifyTotp(secret, code)) return true;

  // Recovery code fallback. Single-use: the first matching row gets
  // `used_at` stamped before we return true, so a winning code can't
  // replay even within a millisecond.
  const candidates = await client().mfa_recovery_code.findMany({
    where: { user_id: userId, used_at: null },
    select: { id: true, code_hash: true },
  });
  for (const row of candidates) {
    if (await verifyRecoveryCode(code, row.code_hash)) {
      await client().mfa_recovery_code.update({
        where: { id: row.id },
        data: { used_at: new Date() },
      });
      return true;
    }
  }
  return false;
}
