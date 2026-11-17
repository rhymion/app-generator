/**
 * Re-encrypts every value stored under a key derived from `AUTH_SECRET` with the current key
 * (Issue #1291): `user.mfa_secret` and `attachment.encrypted_original_name` (with its `name_iv`).
 * Run by `npm run secrets:reencrypt` after `AUTH_SECRET` was rotated, with the old value still
 * in `AUTH_SECRET_PREVIOUS`; once it reports no failures, `AUTH_SECRET_PREVIOUS` can be removed.
 *
 * Rows are read in id order, a page at a time. A value already under the current key is left
 * alone, so a second run changes nothing. Each write is conditional on the stored value being
 * unchanged, so a concurrent enrolment or upload is never overwritten. A value neither secret
 * decrypts is counted as failed, by id only, and the run goes on.
 */
import { decryptSecret, encryptSecret } from '@/lib/mfa/crypto';
import { isSealedWithCurrentKey } from '@/lib/auth/secret-key-ring';
import { decryptFileName, encryptFileName, isFileNameUnderCurrentKey } from '@/lib/compliance/attachment_name_crypto';

type Page<Row> = (args: { where: object; select: object; orderBy: { id: 'asc' }; take: number; cursor?: { id: string }; skip?: number }) => Promise<Row[]>;

export type SecretStore = {
  user: {
    findMany: Page<{ id: string; mfa_secret: string | null }>;
    updateMany: (args: { where: { id: string; mfa_secret: string }; data: { mfa_secret: string } }) => Promise<{ count: number }>;
  };
  attachment: {
    findMany: Page<{ id: string; encrypted_original_name: string | null }>;
    updateMany: (args: {
      where: { id: string; encrypted_original_name: string };
      data: { encrypted_original_name: string; name_iv: string };
    }) => Promise<{ count: number }>;
  };
};

export type ReencryptCounts = { reencrypted: number; current: number; failed: string[] };
export type ReencryptReport = { mfaSecrets: ReencryptCounts; attachmentNames: ReencryptCounts };

const MFA_MISSING_SECRET = 'AUTH_SECRET must be set to re-encrypt stored secrets';

async function eachRow<Row extends { id: string }>(
  page: Page<Row>,
  where: object,
  select: object,
  batchSize: number,
  visit: (row: Row) => Promise<void>,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await page({
      where,
      select,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) await visit(row);
    if (rows.length < batchSize) return;
    cursor = rows[rows.length - 1].id;
  }
}

export async function reencryptStoredSecrets(db: SecretStore, batchSize = 200): Promise<ReencryptReport> {
  const mfaSecrets: ReencryptCounts = { reencrypted: 0, current: 0, failed: [] };
  await eachRow(db.user.findMany, { mfa_secret: { not: null } }, { id: true, mfa_secret: true }, batchSize, async (row) => {
    const stored = row.mfa_secret;
    if (!stored) return;
    if (isSealedWithCurrentKey(stored, MFA_MISSING_SECRET)) {
      mfaSecrets.current += 1;
      return;
    }
    let plaintext: string;
    try {
      plaintext = decryptSecret(stored);
    } catch {
      mfaSecrets.failed.push(row.id);
      return;
    }
    const updated = await db.user.updateMany({
      where: { id: row.id, mfa_secret: stored },
      data: { mfa_secret: encryptSecret(plaintext) },
    });
    if (updated.count === 1) mfaSecrets.reencrypted += 1;
  });

  const attachmentNames: ReencryptCounts = { reencrypted: 0, current: 0, failed: [] };
  await eachRow(
    db.attachment.findMany,
    { encrypted_original_name: { not: null } },
    { id: true, encrypted_original_name: true },
    batchSize,
    async (row) => {
      const stored = row.encrypted_original_name;
      if (!stored) return;
      if (isFileNameUnderCurrentKey(stored)) {
        attachmentNames.current += 1;
        return;
      }
      let name: string;
      try {
        name = decryptFileName(stored);
      } catch {
        attachmentNames.failed.push(row.id);
        return;
      }
      const next = encryptFileName(name);
      const updated = await db.attachment.updateMany({
        where: { id: row.id, encrypted_original_name: stored },
        data: { encrypted_original_name: next.encryptedName, name_iv: next.iv },
      });
      if (updated.count === 1) attachmentNames.reencrypted += 1;
    },
  );

  return { mfaSecrets, attachmentNames };
}
