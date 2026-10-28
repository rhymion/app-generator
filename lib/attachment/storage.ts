// Object storage for attachments: one module for the three backends.
//
// Every object is stored under an opaque random key (a UUID: no extension, no
// original file name, no timestamp). The original file name lives only in
// `attachment.encrypted_original_name` and is decrypted when a file is
// delivered. Objects are never reachable by a public URL: the only way to read
// one is the authorized route app/api/attachments/[id]/route.ts, which calls
// serveStoredObject() after its permission checks.
//
// Backend, chosen from the environment:
//   GCS_BUCKET_NAME set            -> Google Cloud Storage (private bucket, V4 signed URL)
//   BLOB_STORE_ID or
//   BLOB_READ_WRITE_TOKEN set      -> Vercel Blob with `access: 'private'` (the SDK authenticates with
//                                     the short-lived Vercel OIDC token when BLOB_STORE_ID is set, and
//                                     falls back to the read-write token otherwise)
//   neither                        -> local disk under ATTACHMENT_LOCAL_DIR (default `.uploads/`
//                                     at the project root, never under `public/`)
//
// Local disk is not durable on Cloud Run or Vercel (instances are ephemeral and do not share a disk), so
// on those platforms an unresolved backend is a configuration error and throws instead of falling back.

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export type StorageBackend = 'gcs' | 'vercel' | 'local';

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fresh opaque storage key. */
export function newStorageKey(): string {
  return randomUUID();
}

/** Whether `key` has the shape newStorageKey() produces (checked before any storage access). */
export function isStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function storageBackend(env: Record<string, string | undefined> = process.env): StorageBackend {
  if (env.GCS_BUCKET_NAME) return 'gcs';
  if (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) return 'vercel';
  // K_SERVICE is set by Cloud Run, VERCEL by Vercel. A non-development deployment there with no
  // backend configured would otherwise write to an ephemeral disk and lose the files.
  if ((env.K_SERVICE || env.VERCEL) && env.NODE_ENV !== 'development' && !env.ATTACHMENT_LOCAL_DIR) {
    throw new Error(
      'No attachment storage backend is configured. Set GCS_BUCKET_NAME (Google Cloud Storage), ' +
        'BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN (Vercel Blob), or ATTACHMENT_LOCAL_DIR (a persistent local path).',
    );
  }
  return 'local';
}

/** Root directory of the local backend. It is deliberately outside `public/`. */
export function localStorageRoot(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(process.cwd(), env.ATTACHMENT_LOCAL_DIR || '.uploads');
}

function assertKey(key: string): void {
  if (!isStorageKey(key)) throw new Error('Invalid storage key');
}

async function gcsBucket() {
  const { Storage } = await import('@google-cloud/storage');
  return new Storage().bucket(process.env.GCS_BUCKET_NAME!);
}

export async function putStoredObject(key: string, body: Buffer, contentType: string): Promise<void> {
  assertKey(key);
  switch (storageBackend()) {
    case 'gcs': {
      // UBLA bucket: saved without an ACL, the object stays private.
      const bucket = await gcsBucket();
      await bucket.file(key).save(body, { metadata: { contentType } });
      return;
    }
    case 'vercel': {
      const { put } = await import('@vercel/blob');
      await put(key, body, { access: 'private', addRandomSuffix: false, contentType });
      return;
    }
    default: {
      const root = localStorageRoot();
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, key), body);
    }
  }
}

export async function deleteStoredObject(key: string): Promise<void> {
  assertKey(key);
  switch (storageBackend()) {
    case 'gcs': {
      const bucket = await gcsBucket();
      await bucket.file(key).delete({ ignoreNotFound: true });
      return;
    }
    case 'vercel': {
      const { del } = await import('@vercel/blob');
      await del(key);
      return;
    }
    default:
      await rm(path.join(localStorageRoot(), key), { force: true });
  }
}

export type ServeOptions = {
  contentType: string;
  /** Complete Content-Disposition header value. */
  disposition: string;
};

/**
 * The response that delivers one stored object, or null when the object does not exist.
 *
 * All three backends stream the bytes through the route, so the decrypted file name travels only in the
 * response header. A signed URL (GCS) or presigned URL (Blob) would carry it in a query string that
 * can reach browser history and URL-logging proxies.
 */
export async function serveStoredObject(key: string, options: ServeOptions): Promise<Response | null> {
  assertKey(key);
  const headers: Record<string, string> = {
    'Content-Type': options.contentType,
    'Content-Disposition': options.disposition,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
  switch (storageBackend()) {
    case 'gcs': {
      const bucket = await gcsBucket();
      const file = bucket.file(key);
      const [exists] = await file.exists();
      if (!exists) return null;
      const body = Readable.toWeb(file.createReadStream()) as unknown as ReadableStream;
      return new Response(body, { status: 200, headers });
    }
    case 'vercel': {
      const { get } = await import('@vercel/blob');
      const result = await get(key, { access: 'private' });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return new Response(result.stream, { status: 200, headers });
    }
    default: {
      const target = path.join(localStorageRoot(), key);
      let size: number;
      try {
        const stats = await stat(target);
        if (!stats.isFile()) return null;
        size = stats.size;
      } catch {
        return null;
      }
      const body = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
      return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
    }
  }
}
