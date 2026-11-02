import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_UPDATE_AGE_SECONDS,
  resolveSessionPolicy,
} from './session-policy';

describe('resolveSessionPolicy', () => {
  it('uses the Auth.js defaults when nothing is set', () => {
    expect(resolveSessionPolicy({})).toEqual({
      maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS,
      updateAge: DEFAULT_SESSION_UPDATE_AGE_SECONDS,
    });
  });

  it('reads both values from the environment', () => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: '1800', SESSION_UPDATE_AGE_SECONDS: '300' })).toEqual({
      maxAge: 1800,
      updateAge: 300,
    });
  });

  it.each(['', '0', '-5', 'abc', '1.5', '1e3', '99999999999999999999'])('falls back to the default for %j', (raw) => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: raw }).maxAge).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
  });

  it('caps the update age at the max age', () => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: '600' })).toEqual({ maxAge: 600, updateAge: 600 });
  });
});
