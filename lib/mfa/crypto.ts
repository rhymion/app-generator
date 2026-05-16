/**
 * AES-256-GCM encryption for the MFA TOTP secret at rest.
 *
 * The secret stored on `user.mfa_secret` must not be readable from a DB
 * dump alone. We encrypt with a key derived from `AUTH_SECRET` plus a
 * fixed context string, so:
 *
 *   - no new env var is required (one less thing to lose);
 *   - the encryption key is NOT the JWT signing key — rotating
 *     `AUTH_SECRET` invalidates both at once, which is the desired
 *     coupling. If you ever want them to diverge, swap in
 *     `process.env.MFA_KEY` here without touching call sites.
 *
 * Wire format: `v1:<nonce_hex>:<tag_hex>:<ciphertext_hex>`. The `v1:` prefix
 * is a hedge for future algorithm bumps without an out-of-band migration.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const KEY_CONTEXT = 'mfa-encryption-v1';

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET must be set to use MFA');
  }
  return createHash('sha256').update(secret + KEY_CONTEXT).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${nonce.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported MFA secret encoding');
  }
  const [, nonceHex, tagHex, ctHex] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
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
