import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BCRYPT_COST, bcryptCost, hashPassword, passwordNeedsRehash } from './bcrypt-cost';

afterEach(() => {
  delete process.env.BCRYPT_COST;
});

describe('bcryptCost (Issue #1291)', () => {
  it('is 10 when BCRYPT_COST is unset or empty', () => {
    expect(DEFAULT_BCRYPT_COST).toBe(10);
    expect(bcryptCost({})).toBe(10);
    expect(bcryptCost({ BCRYPT_COST: ' ' })).toBe(10);
  });

  it('reads an integer from 10 to 15', () => {
    expect(bcryptCost({ BCRYPT_COST: '10' })).toBe(10);
    expect(bcryptCost({ BCRYPT_COST: '12' })).toBe(12);
    expect(bcryptCost({ BCRYPT_COST: '15' })).toBe(15);
  });

  it('refuses a weaker, an excessive or a malformed cost instead of falling back', () => {
    for (const value of ['9', '4', '16', '31', '12.5', 'abc', '-12', '1e1']) {
      expect(() => bcryptCost({ BCRYPT_COST: value })).toThrow(/BCRYPT_COST must be an integer from 10 to 15/);
    }
  });
});

describe('hashPassword / passwordNeedsRehash', () => {
  it('hashes at the configured cost', async () => {
    process.env.BCRYPT_COST = '11';
    const hash = await hashPassword('pw-123456');
    expect(bcrypt.getRounds(hash)).toBe(11);
    expect(await bcrypt.compare('pw-123456', hash)).toBe(true);
  });

  it('flags a hash whose cost differs from the configured one', async () => {
    const hash10 = await bcrypt.hash('pw', 10);
    expect(passwordNeedsRehash(hash10)).toBe(false);
    process.env.BCRYPT_COST = '11';
    expect(passwordNeedsRehash(hash10)).toBe(true);
  });

  it('does not flag a value that is not a bcrypt hash', () => {
    expect(passwordNeedsRehash('not-a-hash')).toBe(false);
  });
});
