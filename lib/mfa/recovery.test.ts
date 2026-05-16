import { describe, it, expect } from 'vitest';

import { generateRecoveryCodes, plaintextEqual, verifyRecoveryCode } from './recovery';

describe('generateRecoveryCodes', () => {
  it('returns 8 pairs of (plaintext, hash)', async () => {
    const codes = await generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) {
      expect(typeof c.plaintext).toBe('string');
      expect(typeof c.hash).toBe('string');
      expect(c.plaintext.length).toBeGreaterThanOrEqual(8);
      expect(c.hash.startsWith('$2')).toBe(true);
    }
  });

  it('produces all-distinct plaintext codes within a single batch', async () => {
    const codes = await generateRecoveryCodes();
    const plaintexts = new Set(codes.map((c) => c.plaintext));
    expect(plaintexts.size).toBe(codes.length);
  });

  it('formats plaintext with a single dash separator', async () => {
    const codes = await generateRecoveryCodes();
    for (const c of codes) {
      const dashes = (c.plaintext.match(/-/g) || []).length;
      expect(dashes).toBe(1);
    }
  });
});

describe('verifyRecoveryCode', () => {
  it('verifies a freshly-generated code against its own hash', async () => {
    const [first] = await generateRecoveryCodes();
    expect(await verifyRecoveryCode(first.plaintext, first.hash)).toBe(true);
  });

  it('rejects a code whose hash belongs to a different one', async () => {
    const [a, b] = await generateRecoveryCodes();
    expect(await verifyRecoveryCode(a.plaintext, b.hash)).toBe(false);
  });

  it('accepts the same code without the dash (paste-from-manager habit)', async () => {
    const [c] = await generateRecoveryCodes();
    expect(await verifyRecoveryCode(c.plaintext.replace('-', ''), c.hash)).toBe(true);
  });

  it('accepts a code with surrounding whitespace', async () => {
    const [c] = await generateRecoveryCodes();
    expect(await verifyRecoveryCode(`  ${c.plaintext}  `, c.hash)).toBe(true);
  });

  it('rejects an empty input without consulting bcrypt', async () => {
    const [c] = await generateRecoveryCodes();
    expect(await verifyRecoveryCode('', c.hash)).toBe(false);
    expect(await verifyRecoveryCode('   ---', c.hash)).toBe(false);
  });

  it('rejects when the hash is malformed', async () => {
    expect(await verifyRecoveryCode('abcde-fghij', 'not-a-bcrypt-hash')).toBe(false);
  });
});

describe('plaintextEqual', () => {
  it('matches the same code regardless of punctuation/case', () => {
    expect(plaintextEqual('abcde-fghij', 'ABCDEFGHIJ')).toBe(true);
  });

  it('mismatches on different content', () => {
    expect(plaintextEqual('abcde-fghij', 'kkkkk-fghij')).toBe(false);
  });
});
