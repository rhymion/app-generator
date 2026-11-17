import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DEFAULT_SESSION_UPDATE_AGE_SECONDS,
  isPastAbsoluteLifetime,
  resolveSessionPolicy,
} from './session-policy';

describe('resolveSessionPolicy', () => {
  it('uses the Auth.js defaults when nothing is set', () => {
    expect(resolveSessionPolicy({})).toEqual({
      maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS,
      updateAge: DEFAULT_SESSION_UPDATE_AGE_SECONDS,
      absoluteMaxAge: null,
    });
  });

  it('reads both values from the environment', () => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: '1800', SESSION_UPDATE_AGE_SECONDS: '300' })).toEqual({
      maxAge: 1800,
      updateAge: 300,
      absoluteMaxAge: null,
    });
  });

  it.each(['', '0', '-5', 'abc', '1.5', '1e3', '99999999999999999999'])('falls back to the default for %j', (raw) => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: raw }).maxAge).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
  });

  it('caps the update age at the max age', () => {
    expect(resolveSessionPolicy({ SESSION_MAX_AGE_SECONDS: '600' })).toEqual({ maxAge: 600, updateAge: 600, absoluteMaxAge: null });
  });
});

describe('absolute session lifetime', () => {
  it('is disabled unless SESSION_ABSOLUTE_MAX_AGE_SECONDS is a positive integer', () => {
    for (const raw of [undefined, '', '0', '-5', 'abc', '1.5', '1e3']) {
      expect(resolveSessionPolicy({ SESSION_ABSOLUTE_MAX_AGE_SECONDS: raw }).absoluteMaxAge).toBeNull();
    }
    expect(resolveSessionPolicy({ SESSION_ABSOLUTE_MAX_AGE_SECONDS: '43200' }).absoluteMaxAge).toBe(43200);
  });

  it('never expires a session when no limit is configured', () => {
    expect(isPastAbsoluteLifetime(1, null, 10 ** 10)).toBe(false);
    expect(isPastAbsoluteLifetime(undefined, null, 10 ** 10)).toBe(false);
  });

  it('keeps a session younger than the limit and ends one at or past it', () => {
    expect(isPastAbsoluteLifetime(1000, 3600, 1000 + 3599)).toBe(false);
    expect(isPastAbsoluteLifetime(1000, 3600, 1000 + 3600)).toBe(true);
    expect(isPastAbsoluteLifetime(1000, 3600, 1000 + 99999)).toBe(true);
  });

  it.each([undefined, null, 'x', Number.NaN, Number.POSITIVE_INFINITY])(
    'ends a session without a valid start time (%j) once a limit is configured',
    (startedAt) => {
      expect(isPastAbsoluteLifetime(startedAt, 3600, 5000)).toBe(true);
    },
  );
});
