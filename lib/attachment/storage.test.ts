// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@vercel/blob', () => blob);

const gcs = vi.hoisted(() => ({
  save: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
  getSignedUrl: vi.fn(),
  createReadStream: vi.fn(),
  files: [] as string[],
}));
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (key: string) => {
          gcs.files.push(key);
          return { save: gcs.save, delete: gcs.del, exists: gcs.exists, getSignedUrl: gcs.getSignedUrl, createReadStream: gcs.createReadStream };
        },
      };
    }
  },
}));

import {
  deleteStoredObject,
  blobTarget,
  isStorageKey,
  localStorageRoot,
  newStorageKey,
  putStoredObject,
  serveStoredObject,
  storageBackend,
} from './storage';

const ENV_KEYS = ['GCS_BUCKET_NAME', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'ATTACHMENT_BLOB_READ_WRITE_TOKEN', 'ATTACHMENT_LOCAL_DIR'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  gcs.files.length = 0;
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const SERVE = { contentType: 'application/pdf', disposition: 'attachment; filename="contract.pdf"' };

describe('storage keys', () => {
  it('are random UUIDs with no extension, original name or timestamp', () => {
    const a = newStorageKey();
    const b = newStorageKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('.');
    expect(a).not.toContain('/');
    expect(isStorageKey(a)).toBe(true);
  });

  it('reject anything that is not a generated key before storage is touched', () => {
    for (const bad of ['', '../etc/passwd', '1700000000000-abc123/contract.pdf', '/api/gcs/x', 'a/b', 'contract.pdf']) {
      expect(isStorageKey(bad)).toBe(false);
    }
  });
});

describe('blobTarget', () => {
  it('prefers ATTACHMENT_BLOB_READ_WRITE_TOKEN, then BLOB_STORE_ID, then BLOB_READ_WRITE_TOKEN', () => {
    const all = { ATTACHMENT_BLOB_READ_WRITE_TOKEN: 'a', BLOB_STORE_ID: 's', BLOB_READ_WRITE_TOKEN: 'b' };
    expect(blobTarget(all)).toEqual({ token: 'a' });
    expect(blobTarget({ BLOB_STORE_ID: 's', BLOB_READ_WRITE_TOKEN: 'b' })).toEqual({ storeId: 's' });
    expect(blobTarget({ BLOB_READ_WRITE_TOKEN: 'b' })).toEqual({ token: 'b' });
    expect(blobTarget({})).toEqual({});
  });

  it('selects Vercel Blob when only the attachment token is set', () => {
    expect(storageBackend({ ATTACHMENT_BLOB_READ_WRITE_TOKEN: 'a' })).toBe('vercel');
  });
});

describe('backend selection', () => {
  it('uses GCS, then Vercel Blob, then local disk', () => {
    expect(storageBackend({})).toBe('local');
    expect(storageBackend({ BLOB_READ_WRITE_TOKEN: 't' })).toBe('vercel');
    expect(storageBackend({ BLOB_READ_WRITE_TOKEN: 't', GCS_BUCKET_NAME: 'b' })).toBe('gcs');
  });

  it('uses Vercel Blob when only BLOB_STORE_ID (OIDC) is set', () => {
    expect(storageBackend({ BLOB_STORE_ID: 'store_abc' })).toBe('vercel');
  });

  it('throws instead of using local disk on Cloud Run or Vercel when nothing is configured', () => {
    expect(() => storageBackend({ K_SERVICE: 'svc', NODE_ENV: 'production' })).toThrow(/No attachment storage backend/);
    expect(() => storageBackend({ VERCEL: '1', NODE_ENV: 'production' })).toThrow(/BLOB_STORE_ID/);
  });

  it('allows local disk on those platforms only with an explicit ATTACHMENT_LOCAL_DIR or in development', () => {
    expect(storageBackend({ K_SERVICE: 'svc', NODE_ENV: 'production', ATTACHMENT_LOCAL_DIR: '/data' })).toBe('local');
    expect(storageBackend({ VERCEL: '1', NODE_ENV: 'development' })).toBe('local');
  });
});

describe('local backend', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'attachment-storage-'));
    process.env.ATTACHMENT_LOCAL_DIR = dir;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps its root out of public/, so no file is reachable as a static asset', () => {
    delete process.env.ATTACHMENT_LOCAL_DIR;
    const publicDir = path.resolve(process.cwd(), 'public');
    const rel = path.relative(publicDir, localStorageRoot());
    expect(rel.startsWith('..') || path.isAbsolute(rel)).toBe(true);
  });

  it('stores, serves with a nosniff private response, and deletes an object', async () => {
    const key = newStorageKey();
    await putStoredObject(key, Buffer.from('%PDF-bytes'), 'application/pdf');
    expect(await readdir(dir)).toEqual([key]);

    const res = await serveStoredObject(key, SERVE);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('application/pdf');
    expect(res?.headers.get('content-disposition')).toBe(SERVE.disposition);
    expect(res?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res?.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res!.arrayBuffer()).toString()).toBe('%PDF-bytes');

    await deleteStoredObject(key);
    expect(await serveStoredObject(key, SERVE)).toBeNull();
  });

  it('refuses a key that is not a generated one', async () => {
    await expect(serveStoredObject('../secret', SERVE)).rejects.toThrow('Invalid storage key');
    await expect(putStoredObject('a/b', Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid storage key');
    expect(await readFile(path.join(dir, '..')).catch(() => null)).toBeNull();
  });
});

describe('Vercel Blob backend', () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = 'token';
  });

  it('stores objects with private access under the opaque key, never public', async () => {
    const key = newStorageKey();
    blob.put.mockResolvedValue({ url: 'https://x.private.blob.vercel-storage.com/' + key });
    await putStoredObject(key, Buffer.from('x'), 'image/png');
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [pathname, , options] = blob.put.mock.calls[0];
    expect(pathname).toBe(key);
    expect(options).toMatchObject({ access: 'private', addRandomSuffix: false, contentType: 'image/png', token: 'token' });
  });

  it('addresses the store explicitly on put, get and del', async () => {
    const key = newStorageKey();
    blob.put.mockResolvedValue({});
    blob.get.mockResolvedValue(null);
    await putStoredObject(key, Buffer.from('x'), 'image/png');
    await serveStoredObject(key, SERVE);
    await deleteStoredObject(key);
    expect(blob.put.mock.calls[0][2]).toMatchObject({ token: 'token' });
    expect(blob.get).toHaveBeenCalledWith(key, { access: 'private', token: 'token' });
    expect(blob.del).toHaveBeenCalledWith(key, { token: 'token' });
  });

  it('delivers the bytes through the route with the decrypted name as the disposition', async () => {
    const key = newStorageKey();
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response('bytes').body, headers: new Headers() });
    const res = await serveStoredObject(key, SERVE);
    expect(blob.get).toHaveBeenCalledWith(key, { access: 'private', token: 'token' });
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-disposition')).toBe(SERVE.disposition);
    expect(await res!.text()).toBe('bytes');
  });

  it('answers null for a missing object', async () => {
    blob.get.mockResolvedValue(null);
    expect(await serveStoredObject(newStorageKey(), SERVE)).toBeNull();
  });
});

describe('GCS backend', () => {
  beforeEach(() => {
    process.env.GCS_BUCKET_NAME = 'bucket';
  });

  it('saves without an ACL and streams the object with the decrypted file name only in a header', async () => {
    const key = newStorageKey();
    await putStoredObject(key, Buffer.from('x'), 'application/pdf');
    expect(gcs.save).toHaveBeenCalledWith(expect.any(Buffer), { metadata: { contentType: 'application/pdf' } });

    gcs.exists.mockResolvedValue([true]);
    gcs.createReadStream.mockReturnValue(Readable.from([Buffer.from('gcs-bytes')]));
    const res = await serveStoredObject(key, SERVE);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('location')).toBeNull();
    expect(res?.headers.get('content-disposition')).toBe(SERVE.disposition);
    expect(res?.headers.get('content-type')).toBe('application/pdf');
    expect(res?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res?.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res!.arrayBuffer()).toString()).toBe('gcs-bytes');
    // No signed URL (and so no file name in a query string) is ever built.
    expect(gcs.getSignedUrl).not.toHaveBeenCalled();
  });

  it('answers null for an object that does not exist', async () => {
    gcs.exists.mockResolvedValue([false]);
    expect(await serveStoredObject(newStorageKey(), SERVE)).toBeNull();
    expect(gcs.getSignedUrl).not.toHaveBeenCalled();
  });
});
