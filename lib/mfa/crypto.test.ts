import { describe, it, expect, beforeEach } from 'vitest';

import { constantTimeEqual, decryptSecret, encryptSecret } from './crypto';

const SECRET = 'JBSWY3DPEHPK3PXP'; // base32 test vector

beforeEach(() => {
  // Stable AUTH_SECRET so derived keys are deterministic across tests.
  process.env.AUTH_SECRET = 'a'.repeat(64);
});

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

  it('starts with the v1 prefix so future bumps stay distinguishable', () => {
    expect(encryptSecret(SECRET)).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const blob = encryptSecret(SECRET);
    const parts = blob.split(':');
    // Flip the last byte of the ciphertext segment.
    const ct = parts[3];
    parts[3] = ct.slice(0, -2) + (ct.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tampered = parts.join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects unknown version prefixes rather than silently parsing', () => {
    const blob = encryptSecret(SECRET).replace(/^v1:/, 'v2:');
    expect(() => decryptSecret(blob)).toThrow(/Unsupported MFA secret encoding/);
  });

  it('rotating AUTH_SECRET breaks decryption (key derivation depends on it)', () => {
    const blob = encryptSecret(SECRET);
    process.env.AUTH_SECRET = 'b'.repeat(64);
    expect(() => decryptSecret(blob)).toThrow();
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
