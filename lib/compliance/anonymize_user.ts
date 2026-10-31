// Deliberately NOT a 'use server' module: every function exported from a
// 'use server' module is registered as a Server Action that clients can call
// directly. anonymizeUser() trusts the id it is given and holds no permission or
// organization checks; they run in the invalidate wrapper in the entity's
// actions.ts and in the invalidate REST route, which both import this module as
// ordinary server-side code. Do not add the directive here.

// Implements GDPR Art.17 right to erasure via anonymization (irreversible PII scrub).
// Auto-generated from x-pii annotations on the user entity.
// Does NOT physically delete the user row to preserve referential integrity.

import prisma from '@/lib/prisma';
import { deleteStoredObject, isStorageKey } from '@/lib/attachment/storage';

export interface AnonymizeUserResult {
  success: boolean;
  userId: string;
  anonymizedAt: Date;
  errors?: string[];
}

// Removes the stored object behind an attachment after the database transaction has committed.
// `storedKey` is the attachment's opaque storage key.
async function removeStoredFile(storedKey: string): Promise<void> {
  if (!isStorageKey(storedKey)) return;
  await deleteStoredObject(storedKey);
}

export async function anonymizeUser(userId: string): Promise<AnonymizeUserResult> {
  const errors: string[] = [];
  let anonymizedAt = new Date();
  // An object, so that TypeScript keeps the assignment made inside the transaction callback.
  const avatar = { path: null as string | null };

  // Unique placeholder email to satisfy @unique constraint after scrub
  const placeholderEmail = `${userId}@deleted.invalid`;

  try {
    await prisma.$transaction(async (tx) => {
      // 0. A repeated call keeps the first erasure time and still removes
      // whatever related records an earlier call left behind.
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { anonymized_at: true, invalidated_at: true, image_id: true },
      });
      if (!current) throw new Error(`User ${userId} not found`);
      if (current.anonymized_at) anonymizedAt = current.anonymized_at;
      const invalidatedAt = current.invalidated_at ?? anonymizedAt;

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
          image_id: null,
          emailVerified: null,
          mfa_secret: null,
          api_key_hash: null,
          api_key_issued_at: null,
          mfa_enabled: false,
          anonymized_at: anonymizedAt,
          invalidated_at: invalidatedAt,
        },
      });

      // 5. Records that belong to the erased person:
      // the avatar attachment row, the device names of mobile sessions
      // (the rows stay so token revocation keeps working), the person's
      // notifications and the cached responses of their idempotent requests.
      await tx.mobile_session.updateMany({ where: { user_id: userId }, data: { device_name: null } });
      // Revoke the person's mobile sessions so their refresh tokens stop working.
      // Sessions revoked earlier keep their original revocation time.
      await tx.mobile_session.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: anonymizedAt } });
      await tx.notification.deleteMany({ where: { user_id: userId } });
      await tx.idempotency_key.deleteMany({ where: { actor_user_id: userId } });
      if (current.image_id) {
        const row = await tx.attachment.findUnique({ where: { id: current.image_id }, select: { path: true } });
        avatar.path = row?.path ?? null;
        // The user row no longer references the attachment (image_id is null above).
        await tx.attachment.deleteMany({ where: { id: current.image_id } });
      }

      // 5b. audit_log is append-only and its metadata never holds personal data,
      // so nothing in it is redacted here. actor_user_id stays as the
      // pseudonymous key (GDPR Art.17(3)(b)(e)); the person is erased on the
      // user row above.

      // 6. Safety check: verify Account rows are gone
      const remainingAccounts = await tx.account.count({ where: { userId } });
      if (remainingAccounts > 0) {
        throw new Error(`Account rows not removed for user ${userId}`);
      }
    });
  } catch (err) {
    // The detail stays in the server log; callers get a generic message.
    console.error('[anonymizeUser] transaction failed', JSON.stringify(userId), err instanceof Error ? err.name : typeof err);
    errors.push('Anonymization failed');
    return { success: false, userId, anonymizedAt, errors };
  }

  // The stored file goes after the commit: a failure here leaves the erasure
  // in place and is reported instead of rolling it back.
  if (avatar.path) {
    try {
      await removeStoredFile(avatar.path);
    } catch (err) {
      console.error('[anonymizeUser] avatar file removal failed', JSON.stringify(userId), err instanceof Error ? err.name : typeof err);
      errors.push('Stored avatar file was not removed');
    }
  }

  return errors.length > 0 ? { success: true, userId, anonymizedAt, errors } : { success: true, userId, anonymizedAt };
}
