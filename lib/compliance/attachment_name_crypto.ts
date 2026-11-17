/**
 * AES-256-GCM encryption for attachment filenames at rest (P2-5).
 *
 * Stores the original filename encrypted so that PII in filenames
 * (e.g. "John_Smith_passport.pdf") is not readable from a DB dump.
 * The stored `name` field is replaced with a UUID v4.
 *
 * The key is derived from AUTH_SECRET with a distinct context, through the key ring in
 * lib/auth/secret-key-ring.ts, so it is independent from the MFA encryption key, the stored
 * value carries the id of its key (`v2:<key_id>:<nonce_hex>:<tag_hex>:<ciphertext_hex>`), and
 * values written before Issue #1291 (`v1:...`) or under `AUTH_SECRET_PREVIOUS` still decrypt.
 * `npm run secrets:reencrypt` rewrites stored names under the current key.
 *
 * name_iv: the nonce_hex of the stored value (kept separately for clarity).
 */
import { randomUUID } from 'node:crypto';
import { isSealedWithCurrentKey, open, seal } from '@/lib/auth/secret-key-ring';

const KEY_CONTEXT = 'attachment-name-encryption-v1';
const MISSING_SECRET = 'AUTH_SECRET must be set to use attachment name encryption';

export type EncryptedFileName = {
  uuid: string;
  encryptedName: string;
  iv: string;
};

export function encryptFileName(originalName: string): EncryptedFileName {
  const { blob, nonceHex } = seal(KEY_CONTEXT, originalName, MISSING_SECRET);
  return {
    uuid: randomUUID(),
    encryptedName: blob,
    iv: nonceHex,
  };
}

export function decryptFileName(encryptedName: string): string {
  return open(KEY_CONTEXT, encryptedName, 'Unsupported attachment name encoding', MISSING_SECRET);
}

/** True when `encryptedName` is already under the current key. */
export function isFileNameUnderCurrentKey(encryptedName: string): boolean {
  return isSealedWithCurrentKey(encryptedName, MISSING_SECRET);
}
