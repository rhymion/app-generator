// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/_errors';
import { assertDirectAttachmentValue, assertLinkableUpload } from './link';

type Row = { id: string; uploader_id: string | null; linked: boolean };

// A fake attachment table that applies the same filter the real query does.
function fakeTx(rows: Row[]) {
  return {
    attachment: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id && r.uploader_id === where.uploader_id && (where.attachable_id !== null || !r.linked));
        return row ? { id: row.id } : null;
      },
    },
  } as never;
}
const UNLINKED = { attachable_id: null } as const;

describe('assertLinkableUpload', () => {
  const rows: Row[] = [
    { id: 'mine', uploader_id: 'alice', linked: false },
    { id: 'theirs', uploader_id: 'bob', linked: false },
    { id: 'mine-linked', uploader_id: 'alice', linked: true },
  ];

  it('accepts an unlinked attachment the caller uploaded', async () => {
    await expect(assertLinkableUpload(fakeTx(rows), 'mine', 'alice', UNLINKED)).resolves.toBeUndefined();
  });

  it('rejects an attachment another user uploaded', async () => {
    await expect(assertLinkableUpload(fakeTx(rows), 'theirs', 'alice', UNLINKED)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an attachment that is already linked, and one that does not exist', async () => {
    await expect(assertLinkableUpload(fakeTx(rows), 'mine-linked', 'alice', UNLINKED)).rejects.toBeInstanceOf(AppError);
    await expect(assertLinkableUpload(fakeTx(rows), 'nope', 'alice', UNLINKED)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('assertDirectAttachmentValue', () => {
  const tx = fakeTx([{ id: 'theirs', uploader_id: 'bob', linked: false }, { id: 'mine', uploader_id: 'alice', linked: false }]);

  it('needs no check for an empty or unchanged value', async () => {
    await expect(assertDirectAttachmentValue(tx, null, 'x', 'alice', 'image_id', UNLINKED)).resolves.toBeUndefined();
    await expect(assertDirectAttachmentValue(tx, undefined, 'x', 'alice', 'image_id', UNLINKED)).resolves.toBeUndefined();
    await expect(assertDirectAttachmentValue(tx, 'theirs', 'theirs', 'alice', 'image_id', UNLINKED)).resolves.toBeUndefined();
  });

  it('rejects a new value whose uploader differs from the caller, as a field error', async () => {
    await expect(assertDirectAttachmentValue(tx, 'theirs', null, 'alice', 'image_id', UNLINKED)).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'image_id',
      reason: 'invalid',
    });
  });

  it('accepts a new value the caller uploaded', async () => {
    await expect(assertDirectAttachmentValue(tx, 'mine', null, 'alice', 'image_id', UNLINKED)).resolves.toBeUndefined();
  });

  it('rejects a value that is not a string', async () => {
    await expect(assertDirectAttachmentValue(tx, 42, null, 'alice', 'image_id', UNLINKED)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
