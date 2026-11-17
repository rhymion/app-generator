import { describe, expect, it } from 'vitest';
import { keyIdOf, keyRing } from './secret-key-ring';

describe('keyRing (Issue #1291)', () => {
  it('needs AUTH_SECRET', () => {
    expect(() => keyRing('no secret', {})).toThrow('no secret');
  });

  it('has only the current key when AUTH_SECRET_PREVIOUS is unset, empty or the same value', () => {
    expect(keyRing('x', { AUTH_SECRET: 'new' })).toEqual({ current: { id: keyIdOf('new'), secret: 'new' }, previous: null });
    expect(keyRing('x', { AUTH_SECRET: 'new', AUTH_SECRET_PREVIOUS: ' ' }).previous).toBeNull();
    expect(keyRing('x', { AUTH_SECRET: 'new', AUTH_SECRET_PREVIOUS: 'new' }).previous).toBeNull();
  });

  it('adds the previous key while rotating', () => {
    expect(keyRing('x', { AUTH_SECRET: 'new', AUTH_SECRET_PREVIOUS: 'old' }).previous).toEqual({ id: keyIdOf('old'), secret: 'old' });
  });
});

describe('keyIdOf', () => {
  it('is 8 hex characters, stable per secret and different between secrets', () => {
    expect(keyIdOf('a')).toMatch(/^[0-9a-f]{8}$/);
    expect(keyIdOf('a')).toBe(keyIdOf('a'));
    expect(keyIdOf('a')).not.toBe(keyIdOf('b'));
  });

  it('does not contain the secret', () => {
    expect(keyIdOf('abcdef12')).not.toContain('abcdef12');
  });
});
