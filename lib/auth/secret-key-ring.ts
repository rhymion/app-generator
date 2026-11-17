/**
 * Encryption of values stored at rest under keys derived from `AUTH_SECRET`, with a key id in
 * each value so the secret can be rotated (Issue #1291, ASVS V11.2.2).
 * See docs/knowledge/authentication.md "Rotating AUTH_SECRET".
 *
 * Key: SHA-256(secret + context), one context per kind of value, so the MFA key and the
 * attachment-name key are independent. Cipher: AES-256-GCM with a random 96-bit nonce.
 *
 * Wire formats:
 *   v2:<key_id>:<nonce_hex>:<tag_hex>:<ciphertext_hex>   written now. `key_id` is the first
 *       8 hex characters of SHA-256("key-id:" + secret); "v2:<key_id>" is bound as additional
 *       authenticated data, so the id cannot be swapped without failing decryption.
 *   v1:<nonce_hex>:<tag_hex>:<ciphertext_hex>            written before #1291, no key id.
 *       Read with the current secret, then with the previous one.
 *
 * Rotation: set the new value in `AUTH_SECRET` and the old one in `AUTH_SECRET_PREVIOUS`. Values
 * under either key decrypt; new writes use the current key; `npm run secrets:reencrypt`
 * rewrites every stored value under the current key, after which `AUTH_SECRET_PREVIOUS` can be
 * removed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { secretsEqual } from '@/lib/_secret_compare';

const CURRENT_VERSION = 'v2';
const LEGACY_VERSION = 'v1';

export type KeyRingEntry = { id: string; secret: string };
export type KeyRing = { current: KeyRingEntry; previous: KeyRingEntry | null };

/** The key id of `secret`: identifies the secret without revealing it. */
export function keyIdOf(secret: string): string {
  return createHash('sha256').update(`key-id:${secret}`).digest('hex').slice(0, 8);
}

/** The current and the optional previous secret. Throws `missingSecretMessage` when `AUTH_SECRET` is unset. */
export function keyRing(missingSecretMessage: string, env: Record<string, string | undefined> = process.env): KeyRing {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error(missingSecretMessage);
  const previousSecret = (env.AUTH_SECRET_PREVIOUS ?? '').trim();
  const previous = previousSecret && !secretsEqual(previousSecret, secret) ? { id: keyIdOf(previousSecret), secret: previousSecret } : null;
  return { current: { id: keyIdOf(secret), secret }, previous };
}

function deriveKey(secret: string, context: string): Buffer {
  return createHash('sha256').update(secret + context).digest();
}

export type SealedValue = { blob: string; nonceHex: string };

/** Encrypts `plaintext` under the current key. */
export function seal(context: string, plaintext: string, missingSecretMessage: string): SealedValue {
  const { current } = keyRing(missingSecretMessage);
  const nonce = randomBytes(12);
  const header = `${CURRENT_VERSION}:${current.id}`;
  const cipher = createCipheriv('aes-256-gcm', deriveKey(current.secret, context), nonce);
  cipher.setAAD(Buffer.from(header, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const nonceHex = nonce.toString('hex');
  return {
    blob: `${header}:${nonceHex}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`,
    nonceHex,
  };
}

function decrypt(key: Buffer, nonceHex: string, tagHex: string, ctHex: string, aad: string | null): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
  if (aad !== null) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * Decrypts a value written by `seal` (v2) or by the pre-#1291 code (v1). Throws
 * `unsupportedMessage` for any other shape, an error naming the key id when neither configured
 * secret has it, and the cipher's error when the value was altered.
 */
export function open(context: string, blob: string, unsupportedMessage: string, missingSecretMessage: string): string {
  const ring = keyRing(missingSecretMessage);
  const parts = blob.split(':');
  if (parts.length === 5 && parts[0] === CURRENT_VERSION) {
    const [, id, nonceHex, tagHex, ctHex] = parts;
    const entry = [ring.current, ring.previous].find((e) => e?.id === id);
    if (!entry) throw new Error(`No configured secret has key id ${id} (set AUTH_SECRET_PREVIOUS while rotating)`);
    return decrypt(deriveKey(entry.secret, context), nonceHex, tagHex, ctHex, `${CURRENT_VERSION}:${id}`);
  }
  if (parts.length === 4 && parts[0] === LEGACY_VERSION) {
    const [, nonceHex, tagHex, ctHex] = parts;
    try {
      return decrypt(deriveKey(ring.current.secret, context), nonceHex, tagHex, ctHex, null);
    } catch (err) {
      if (!ring.previous) throw err;
      return decrypt(deriveKey(ring.previous.secret, context), nonceHex, tagHex, ctHex, null);
    }
  }
  throw new Error(unsupportedMessage);
}

/** True when `blob` is in the current format under the current key, so re-encrypting it changes nothing. */
export function isSealedWithCurrentKey(blob: string, missingSecretMessage: string): boolean {
  const parts = blob.split(':');
  return parts.length === 5 && parts[0] === CURRENT_VERSION && parts[1] === keyRing(missingSecretMessage).current.id;
}
