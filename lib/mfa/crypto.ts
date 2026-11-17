/**
 * AES-256-GCM encryption for the MFA TOTP secret at rest.
 *
 * The secret stored on `user.mfa_secret` must not be readable from a DB dump alone. It is
 * encrypted with a key derived from `AUTH_SECRET` plus a fixed context string, through the key
 * ring in lib/auth/secret-key-ring.ts: the stored value carries the id of the key that encrypted
 * it (`v2:<key_id>:...`), values written before Issue #1291 (`v1:...`) still decrypt, and while
 * `AUTH_SECRET` is being rotated (`AUTH_SECRET_PREVIOUS` set) values under the old key decrypt
 * too. A successful sign-in re-encrypts a value under the current key (`reencryptedSecret`), and
 * `npm run secrets:reencrypt` does it for every row.
 */
import { timingSafeEqual } from 'node:crypto';
import { isSealedWithCurrentKey, open, seal } from '@/lib/auth/secret-key-ring';

const KEY_CONTEXT = 'mfa-encryption-v1';
const MISSING_SECRET = 'AUTH_SECRET must be set to use MFA';

export function encryptSecret(plaintext: string): string {
  return seal(KEY_CONTEXT, plaintext, MISSING_SECRET).blob;
}

export function decryptSecret(blob: string): string {
  return open(KEY_CONTEXT, blob, 'Unsupported MFA secret encoding', MISSING_SECRET);
}

/**
 * The value to store instead of `blob` when it is not under the current key (an old format or
 * the previous secret), or null when it already is. `plaintext` is the decrypted secret.
 */
export function reencryptedSecret(blob: string, plaintext: string): string | null {
  return isSealedWithCurrentKey(blob, MISSING_SECRET) ? null : encryptSecret(plaintext);
}

/** Constant-time string compare. Use for verifying user-supplied codes. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still spend time so an attacker can't infer length from a short-circuit.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
