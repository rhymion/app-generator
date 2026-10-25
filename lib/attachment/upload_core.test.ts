// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: { attachment: { create: db.create }, organization: { findFirst: db.findFirst } },
}));

import { decryptFileName } from '@/lib/compliance/attachment_name_crypto';
import { isStorageKey } from './storage';
import { storeUploadedFile, toDisplayFilename } from './upload_core';

let dir: string;
const saved = { secret: process.env.AUTH_SECRET, dir: process.env.ATTACHMENT_LOCAL_DIR, gcs: process.env.GCS_BUCKET_NAME, blob: process.env.BLOB_READ_WRITE_TOKEN };

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(path.join(os.tmpdir(), 'upload-core-'));
  process.env.ATTACHMENT_LOCAL_DIR = dir;
  process.env.AUTH_SECRET = 'test-secret';
  delete process.env.GCS_BUCKET_NAME;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  db.findFirst.mockResolvedValue({ id: 'org-1' });
  db.create.mockResolvedValue({ id: 'att-1' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const [k, v] of [['AUTH_SECRET', saved.secret], ['ATTACHMENT_LOCAL_DIR', saved.dir], ['GCS_BUCKET_NAME', saved.gcs], ['BLOB_READ_WRITE_TOKEN', saved.blob]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const file = (name: string) => ({ name, arrayBuffer: async () => new TextEncoder().encode('contents').buffer as ArrayBuffer });

describe('storeUploadedFile', () => {
  it('stores the object under an opaque key that carries nothing from the file name', async () => {
    const result = await storeUploadedFile(file('Secret Contract 2026-10.pdf'), 'application/pdf', 'user-1');
    const [stored] = await readdir(dir);
    expect(isStorageKey(stored)).toBe(true);
    expect(stored).not.toMatch(/secret|contract|pdf|2026/i);

    const data = db.create.mock.calls[0][0].data;
    expect(data.path).toBe(stored);
    expect(data.path).not.toMatch(/secret|contract|pdf/i);
    // The original name is kept only encrypted, and reads back as the original.
    expect(decryptFileName(data.encrypted_original_name)).toBe('Secret Contract 2026-10.pdf');
    expect(data.name).not.toMatch(/secret|contract/i);
    expect(result).toEqual({ id: 'att-1', name: 'Secret Contract 2026-10.pdf' });
  });

  it('records the uploader and the uploader organization, and leaves the row unlinked', async () => {
    await storeUploadedFile(file('a.txt'), 'text/plain', 'user-1');
    const data = db.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ uploader_id: 'user-1', uploader_organization_id: 'org-1', attachable_id: null });
  });

  it('records no organization for a user who has none', async () => {
    db.findFirst.mockResolvedValue(null);
    await storeUploadedFile(file('a.txt'), 'text/plain', 'user-1');
    expect(db.create.mock.calls[0][0].data.uploader_organization_id).toBeNull();
  });

  it('removes the object again when the row cannot be created', async () => {
    db.create.mockRejectedValue(new Error('db down'));
    await expect(storeUploadedFile(file('a.txt'), 'text/plain', 'user-1')).rejects.toThrow('db down');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('toDisplayFilename', () => {
  it('keeps only the last path segment and drops control characters', () => {
    expect(toDisplayFilename('../../etc/passwd')).toBe('passwd');
    expect(toDisplayFilename('C:\\Users\\a\\b.pdf')).toBe('b.pdf');
    expect(toDisplayFilename('a\u0000b.txt')).toBe('ab.txt');
    expect(toDisplayFilename('..')).toBe('file');
    expect(toDisplayFilename('')).toBe('file');
  });
});
