import { beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/mfa/crypto';
import { decryptFileName, encryptFileName } from '@/lib/compliance/attachment_name_crypto';
import { keyIdOf } from './secret-key-ring';
import { reencryptStoredSecrets, type SecretStore } from './reencrypt-stored-secrets';

const OLD = 'o'.repeat(64);
const NEW = 'n'.repeat(64);

type UserRow = { id: string; mfa_secret: string | null };
type AttachmentRow = { id: string; encrypted_original_name: string | null; name_iv: string | null };

/** An in-memory stand-in for the two tables, with Prisma's cursor paging and conditional updateMany. */
function fakeDb(users: UserRow[], attachments: AttachmentRow[]) {
  function page<Row extends { id: string }>(rows: Row[], column: keyof Row) {
    return async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
      const sorted = rows.filter((r) => r[column] !== null).sort((a, b) => a.id.localeCompare(b.id));
      const start = args.cursor ? sorted.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
      return sorted.slice(start, start + args.take).map((r) => ({ ...r }));
    };
  }
  const db = {
    user: {
      findMany: page(users, 'mfa_secret'),
      updateMany: async ({ where, data }: { where: { id: string; mfa_secret: string }; data: { mfa_secret: string } }) => {
        // Conditional write, like Prisma's updateMany with the stored value in `where`.
        const row = users.find((u) => u.id === where.id && Object.is(u.mfa_secret, where.mfa_secret));
        if (row) row.mfa_secret = data.mfa_secret;
        return { count: row ? 1 : 0 };
      },
    },
    attachment: {
      findMany: page(attachments, 'encrypted_original_name'),
      updateMany: async ({ where, data }: { where: { id: string; encrypted_original_name: string }; data: { encrypted_original_name: string; name_iv: string } }) => {
        const row = attachments.find((a) => a.id === where.id && a.encrypted_original_name === where.encrypted_original_name);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
  };
  return db as unknown as SecretStore;
}

beforeEach(() => {
  process.env.AUTH_SECRET = OLD;
  delete process.env.AUTH_SECRET_PREVIOUS;
});

describe('reencryptStoredSecrets (Issue #1291)', () => {
  it('moves every value to the current key after rotation, across pages, and a second run changes nothing', async () => {
    const users: UserRow[] = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, mfa_secret: encryptSecret(`TOTP${i}`) }));
    users.push({ id: 'u9', mfa_secret: null });
    const attachments: AttachmentRow[] = Array.from({ length: 3 }, (_, i) => {
      const e = encryptFileName(`file${i}.pdf`);
      return { id: `a${i}`, encrypted_original_name: e.encryptedName, name_iv: e.iv };
    });

    process.env.AUTH_SECRET = NEW;
    process.env.AUTH_SECRET_PREVIOUS = OLD;
    const db = fakeDb(users, attachments);
    const report = await reencryptStoredSecrets(db, 2);
    expect(report.mfaSecrets).toEqual({ reencrypted: 5, current: 0, failed: [] });
    expect(report.attachmentNames).toEqual({ reencrypted: 3, current: 0, failed: [] });

    delete process.env.AUTH_SECRET_PREVIOUS;
    users.slice(0, 5).forEach((u, i) => {
      expect(u.mfa_secret!.split(':')[1]).toBe(keyIdOf(NEW));
      expect(decryptSecret(u.mfa_secret!)).toBe(`TOTP${i}`);
    });
    attachments.forEach((a, i) => {
      expect(decryptFileName(a.encrypted_original_name!)).toBe(`file${i}.pdf`);
      expect(a.encrypted_original_name!.split(':')[2]).toBe(a.name_iv);
    });

    const again = await reencryptStoredSecrets(db, 2);
    expect(again.mfaSecrets).toEqual({ reencrypted: 0, current: 5, failed: [] });
    expect(again.attachmentNames).toEqual({ reencrypted: 0, current: 3, failed: [] });
  });

  it('reports a value no configured secret decrypts by id and leaves it unchanged', async () => {
    const lost = encryptSecret('TOTP');
    process.env.AUTH_SECRET = NEW;
    const users: UserRow[] = [{ id: 'u1', mfa_secret: lost }];
    const report = await reencryptStoredSecrets(fakeDb(users, []));
    expect(report.mfaSecrets.failed).toEqual(['u1']);
    expect(users[0].mfa_secret).toBe(lost);
  });
});
