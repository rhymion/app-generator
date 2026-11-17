import { describe, it, expect, beforeEach } from 'vitest';

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { constantTimeEqual, decryptSecret, encryptSecret, reencryptedSecret } from './crypto';
import { keyIdOf } from '@/lib/auth/secret-key-ring';

const SECRET = 'JBSWY3DPEHPK3PXP'; // base32 test vector

beforeEach(() => {
  // Stable AUTH_SECRET so derived keys are deterministic across tests.
  process.env.AUTH_SECRET = 'a'.repeat(64);
  delete process.env.AUTH_SECRET_PREVIOUS;
});

/** A value in the pre-#1291 format (`v1:`, no key id), as the old code wrote it. */
function legacyBlob(plaintext: string, secret: string): string {
  const key = createHash('sha256').update(secret + 'mfa-encryption-v1').digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1:${nonce.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trips plaintext back to itself', () => {
    const blob = encryptSecret(SECRET);
    expect(decryptSecret(blob)).toBe(SECRET);
  });

  it('produces a fresh ciphertext per call (random nonce)', () => {
    const a = encryptSecret(SECRET);
    const b = encryptSecret(SECRET);
    expect(a).not.toBe(b);
  });

  it('writes the v2 format with the key id of AUTH_SECRET (Issue #1291)', () => {
    const blob = encryptSecret(SECRET);
    expect(blob).toMatch(/^v2:[0-9a-f]{8}:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(blob.split(':')[1]).toBe(keyIdOf('a'.repeat(64)));
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const blob = encryptSecret(SECRET);
    const parts = blob.split(':');
    // Flip the last byte of the ciphertext segment.
    const ct = parts[4];
    parts[4] = ct.slice(0, -2) + (ct.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tampered = parts.join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects unknown version prefixes rather than silently parsing', () => {
    const blob = encryptSecret(SECRET).replace(/^v2:/, 'v3:');
    expect(() => decryptSecret(blob)).toThrow(/Unsupported MFA secret encoding/);
  });

  it('a value under a secret that is neither AUTH_SECRET nor AUTH_SECRET_PREVIOUS does not decrypt', () => {
    const blob = encryptSecret(SECRET);
    process.env.AUTH_SECRET = 'b'.repeat(64);
    expect(() => decryptSecret(blob)).toThrow(/No configured secret has key id/);
  });

  it('decrypts a value under AUTH_SECRET_PREVIOUS while the secret is rotated', () => {
    const blob = encryptSecret(SECRET);
    process.env.AUTH_SECRET = 'b'.repeat(64);
    process.env.AUTH_SECRET_PREVIOUS = 'a'.repeat(64);
    expect(decryptSecret(blob)).toBe(SECRET);
  });

  it('decrypts a pre-#1291 v1 value with the current or the previous secret', () => {
    expect(decryptSecret(legacyBlob(SECRET, 'a'.repeat(64)))).toBe(SECRET);
    const old = legacyBlob(SECRET, 'a'.repeat(64));
    process.env.AUTH_SECRET = 'b'.repeat(64);
    expect(() => decryptSecret(old)).toThrow();
    process.env.AUTH_SECRET_PREVIOUS = 'a'.repeat(64);
    expect(decryptSecret(old)).toBe(SECRET);
  });

  it('refuses a value whose key id was swapped (the id is authenticated)', () => {
    const blob = encryptSecret(SECRET);
    process.env.AUTH_SECRET_PREVIOUS = 'b'.repeat(64);
    const swapped = blob.replace(/^v2:[0-9a-f]{8}:/, `v2:${keyIdOf('b'.repeat(64))}:`);
    expect(() => decryptSecret(swapped)).toThrow();
  });
});

describe('reencryptedSecret', () => {
  it('is null for a value already under the current key', () => {
    expect(reencryptedSecret(encryptSecret(SECRET), SECRET)).toBeNull();
  });

  it('re-encrypts a v1 value and a value under the previous secret with the current key', () => {
    const legacy = legacyBlob(SECRET, 'a'.repeat(64));
    const fromLegacy = reencryptedSecret(legacy, SECRET);
    expect(fromLegacy?.split(':')[1]).toBe(keyIdOf('a'.repeat(64)));

    const old = encryptSecret(SECRET);
    process.env.AUTH_SECRET = 'b'.repeat(64);
    process.env.AUTH_SECRET_PREVIOUS = 'a'.repeat(64);
    const next = reencryptedSecret(old, SECRET);
    expect(next?.split(':')[1]).toBe(keyIdOf('b'.repeat(64)));
    delete process.env.AUTH_SECRET_PREVIOUS;
    expect(decryptSecret(next as string)).toBe(SECRET);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for unequal strings of the same length', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('a', 'ab')).toBe(false);
  });
});
