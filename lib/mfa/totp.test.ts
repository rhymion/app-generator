import { describe, it, expect } from 'vitest';
import { generate as otplibGenerate } from 'otplib';

import { generateSecret, otpauthUrl, verifyTotp } from './totp';

describe('generateSecret', () => {
  it('returns a base32 string', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it('produces a fresh secret per call', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe('verifyTotp', () => {
  it('accepts the current 6-digit code for the matching secret', async () => {
    const secret = generateSecret();
    const code = await otplibGenerate({ secret });
    expect(await verifyTotp(secret, code)).toBe(true);
  });

  it('strips whitespace so codes copied as "123 456" still verify', async () => {
    const secret = generateSecret();
    const code = await otplibGenerate({ secret });
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(await verifyTotp(secret, spaced)).toBe(true);
  });

  it('rejects non-numeric input without consulting the secret', async () => {
    expect(await verifyTotp(generateSecret(), 'abcdef')).toBe(false);
  });

  it('rejects codes that are the wrong length', async () => {
    expect(await verifyTotp(generateSecret(), '12345')).toBe(false);
    expect(await verifyTotp(generateSecret(), '1234567')).toBe(false);
  });

  it('rejects a malformed secret without throwing', async () => {
    // otplib v13 enforces MIN_SECRET_BYTES (16) at generation time, so we
    // derive the test token from a freshly-generated full-size secret and
    // verify it against a deliberately bogus one.
    const code = await otplibGenerate({ secret: generateSecret() });
    expect(await verifyTotp('not-a-base32-secret!!', code)).toBe(false);
  });
});

describe('otpauthUrl', () => {
  it('encodes issuer + account in the otpauth URL', async () => {
    const url = await otpauthUrl('JBSWY3DPEHPK3PXP', 'alice@example.com');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=my-next');
    // Account is URL-encoded; the '@' becomes %40.
    expect(url).toContain('alice%40example.com');
  });
});
