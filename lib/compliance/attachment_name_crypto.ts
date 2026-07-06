/**
 * AES-256-GCM encryption for attachment filenames at rest (P2-5).
 *
 * Stores the original filename encrypted so that PII in filenames
 * (e.g. "John_Smith_passport.pdf") is not readable from a DB dump.
 * The stored `name` field is replaced with a UUID v4.
 *
 * Key derivation reuses AUTH_SECRET with a distinct KEY_CONTEXT so
 * no new environment variable is required, and the key is independent
 * from the MFA encryption key.
 *
 * Wire format for encrypted_original_name: `v1:<nonce_hex>:<tag_hex>:<ciphertext_hex>`
 * Wire format for name_iv: same nonce_hex value (stored separately for clarity).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const VERSION = 'v1';
const KEY_CONTEXT = 'attachment-name-encryption-v1';

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET must be set to use attachment name encryption');
  }
  return createHash('sha256').update(secret + KEY_CONTEXT).digest();
}

export type EncryptedFileName = {
  uuid: string;
  encryptedName: string;
  iv: string;
};

export function encryptFileName(originalName: string): EncryptedFileName {
  const key = deriveKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(originalName, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const nonceHex = nonce.toString('hex');
  const encryptedName = `${VERSION}:${nonceHex}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  return {
    uuid: randomUUID(),
    encryptedName,
    iv: nonceHex,
  };
}

export function decryptFileName(encryptedName: string): string {
  const parts = encryptedName.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported attachment name encoding');
  }
  const [, nonceHex, tagHex, ctHex] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
