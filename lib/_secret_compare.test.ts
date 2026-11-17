import { describe, expect, it } from 'vitest';
import { secretsEqual } from './_secret_compare';

describe('secretsEqual', () => {
  it('matches equal secrets', () => {
    expect(secretsEqual('Bearer s3cret', 'Bearer s3cret')).toBe(true);
  });

  it('rejects unequal secrets of the same length', () => {
    expect(secretsEqual('Bearer s3cret', 'Bearer s3creT')).toBe(false);
  });

  it('rejects secrets of different lengths without throwing', () => {
    expect(secretsEqual('short', 'a-much-longer-secret')).toBe(false);
    expect(secretsEqual('a-much-longer-secret', 'short')).toBe(false);
  });

  it('never matches an empty or missing value', () => {
    expect(secretsEqual('', '')).toBe(false);
    expect(secretsEqual('x', '')).toBe(false);
    expect(secretsEqual('', 'x')).toBe(false);
    expect(secretsEqual(null, 'x')).toBe(false);
    expect(secretsEqual('x', undefined)).toBe(false);
  });
});
