'use server';

// Implements GDPR Art.17 right to erasure via anonymization (irreversible PII scrub).
// Does NOT physically delete the user row to preserve referential integrity.

import prisma from '@/lib/prisma';

export interface AnonymizeUserResult {
  success: boolean;
  userId: string;
  anonymizedAt: Date;
  errors?: string[];
}

export async function anonymizeUser(userId: string): Promise<AnonymizeUserResult> {
  const errors: string[] = [];
  const anonymizedAt = new Date();

  // Unique placeholder email to satisfy @unique constraint after scrub
  const placeholderEmail = `${userId}@deleted.invalid`;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete linked OAuth accounts (contain access/refresh tokens — sensitive PII)
      await tx.account.deleteMany({ where: { userId } });

      // 2. Delete active sessions
      await tx.session.deleteMany({ where: { userId } });

      // 3. Delete MFA recovery codes (contain hashed TOTP secrets)
      await tx.mfa_recovery_code.deleteMany({ where: { user_id: userId } });

      // 4. Scrub PII fields on the user row
      await tx.user.update({
        where: { id: userId },
        data: {
          name: '[deleted]',
          email: placeholderEmail,
          password: null,
          api_key: null,
          image: null,
          emailVerified: null,
          mfa_secret: null,
          mfa_enabled: false,
          anonymized_at: anonymizedAt,
        },
      });

      // 5. Null out actor_user_id in audit_log rows (preserve rows per Restrict design)
      // DP-6 ruling: Restrict maintained + actor_user_id NULL on erasure request
      await tx.audit_log.updateMany({
        where: { actor_user_id: userId },
        data: { actor_user_id: null },
      });

      // 6. Safety check: verify Account rows are gone
      const remainingAccounts = await tx.account.count({ where: { userId } });
      if (remainingAccounts > 0) {
        throw new Error(`Account rows not removed for user ${userId}`);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    return { success: false, userId, anonymizedAt, errors };
  }

  return { success: true, userId, anonymizedAt };
}
