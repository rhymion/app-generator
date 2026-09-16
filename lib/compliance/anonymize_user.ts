'use server';

// Implements GDPR Art.17 right to erasure via anonymization (irreversible PII scrub).
// Auto-generated from x-pii annotations on the user entity.
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
          image_id: null,
          emailVerified: null,
          mfa_secret: null,
          mfa_enabled: false,
          anonymized_at: anonymizedAt,
          invalidated_at: anonymizedAt,
        },
      });

      // 5. Redact PII from audit_log metadata (actor_user_id retained per DP-6 ruling)
      // GDPR Art.17(3)(b)(e): actor_user_id preserved as pseudonymous key for audit chain.
      // Only PII values inside metadata JSON are redacted.
      const auditRows = await tx.audit_log.findMany({ where: { actor_user_id: userId } });
      await Promise.all(auditRows.map(async (row) => {
        if (!row.metadata) return;
        const meta = (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>;
        let changed = false;
        for (const key of ['email', 'name', 'display_name', 'username']) {
          if (key in meta) { meta[key] = '[redacted]'; changed = true; }
        }
        if (changed) {
          await tx.audit_log.update({ where: { id: row.id }, data: { metadata: meta as object } });
        }
      }));

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
