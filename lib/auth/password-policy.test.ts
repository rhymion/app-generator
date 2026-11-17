import { describe, expect, it } from 'vitest';

import { MIN_PASSWORD_LENGTH, passwordPolicyError } from './password-policy';

describe('passwordPolicyError', () => {
  it('rejects a password shorter than the minimum and non-strings', () => {
    expect(passwordPolicyError('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 8 characters/);
    expect(passwordPolicyError('')).not.toBeNull();
    expect(passwordPolicyError(undefined)).not.toBeNull();
    expect(passwordPolicyError(12345678)).not.toBeNull();
  });

  it('accepts a password of the minimum length, with no composition rule', () => {
    expect(passwordPolicyError('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordPolicyError('correct horse battery')).toBeNull();
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(passwordPolicyError('😀'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordPolicyError('😀'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
  });
});
