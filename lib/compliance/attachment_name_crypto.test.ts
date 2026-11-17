import { beforeEach, describe, expect, it } from 'vitest';
import { decryptFileName, encryptFileName, isFileNameUnderCurrentKey } from './attachment_name_crypto';
import { keyIdOf } from '@/lib/auth/secret-key-ring';

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(64);
  delete process.env.AUTH_SECRET_PREVIOUS;
});

describe('attachment name encryption (Issue #1291)', () => {
  it('writes v2 with the key id, and name_iv is the nonce of the stored value', () => {
    const out = encryptFileName('passport.pdf');
    const parts = out.encryptedName.split(':');
    expect(parts[0]).toBe('v2');
    expect(parts[1]).toBe(keyIdOf('a'.repeat(64)));
    expect(parts[2]).toBe(out.iv);
    expect(decryptFileName(out.encryptedName)).toBe('passport.pdf');
    expect(isFileNameUnderCurrentKey(out.encryptedName)).toBe(true);
  });

  it('decrypts under AUTH_SECRET_PREVIOUS while rotating and is no longer current', () => {
    const out = encryptFileName('passport.pdf');
    process.env.AUTH_SECRET = 'b'.repeat(64);
    expect(() => decryptFileName(out.encryptedName)).toThrow(/No configured secret has key id/);
    process.env.AUTH_SECRET_PREVIOUS = 'a'.repeat(64);
    expect(decryptFileName(out.encryptedName)).toBe('passport.pdf');
    expect(isFileNameUnderCurrentKey(out.encryptedName)).toBe(false);
  });

  it('uses a key independent from the MFA key', async () => {
    const { decryptSecret } = await import('@/lib/mfa/crypto');
    expect(() => decryptSecret(encryptFileName('x').encryptedName)).toThrow();
  });
});
