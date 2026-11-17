import { describe, it, expect } from 'vitest';
import { siteConfig } from '@/lib/site-config';
import {
  ApiKeyExpiryError,
  FALLBACK_API_KEY_EXPIRY_DAYS,
  getDefaultApiKeyExpiry,
  getDefaultApiKeyExpiryDays,
  parseRequestedApiKeyExpiry,
} from './api-key-expiry';

const auth = siteConfig.auth as { apiKeyDefaultExpiryDays?: number | null };

function withSetting<T>(value: number | null | undefined, fn: () => T): T {
  const saved = auth.apiKeyDefaultExpiryDays;
  if (value === undefined) delete auth.apiKeyDefaultExpiryDays;
  else auth.apiKeyDefaultExpiryDays = value;
  try {
    return fn();
  } finally {
    auth.apiKeyDefaultExpiryDays = saved;
  }
}

describe('default API key expiry', () => {
  it('uses the site setting', () => {
    expect(withSetting(30, getDefaultApiKeyExpiryDays)).toBe(30);
  });
  it('applies the generator default when the setting is absent', () => {
    expect(withSetting(undefined, getDefaultApiKeyExpiryDays)).toBe(FALLBACK_API_KEY_EXPIRY_DAYS);
    expect(FALLBACK_API_KEY_EXPIRY_DAYS).toBe(90);
  });
  it('means no expiry when the setting is null', () => {
    expect(withSetting(null, getDefaultApiKeyExpiryDays)).toBeNull();
    expect(withSetting(null, () => getDefaultApiKeyExpiry())).toBeNull();
  });
  it('falls back for a nonsensical setting', () => {
    expect(withSetting(0, getDefaultApiKeyExpiryDays)).toBe(FALLBACK_API_KEY_EXPIRY_DAYS);
    expect(withSetting(Number.NaN, getDefaultApiKeyExpiryDays)).toBe(FALLBACK_API_KEY_EXPIRY_DAYS);
  });
  it('counts the days from the issue time', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(withSetting(10, () => getDefaultApiKeyExpiry(now))?.toISOString()).toBe('2026-01-11T00:00:00.000Z');
  });
});

describe('parseRequestedApiKeyExpiry', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('accepts null as never expires and a future date', () => {
    expect(parseRequestedApiKeyExpiry(null, now)).toBeNull();
    expect(parseRequestedApiKeyExpiry('2026-01-02T00:00:00Z', now)?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
  it('rejects a past date, the present instant and garbage', () => {
    expect(() => parseRequestedApiKeyExpiry('2025-12-31T00:00:00Z', now)).toThrow(ApiKeyExpiryError);
    expect(() => parseRequestedApiKeyExpiry('2026-01-01T00:00:00Z', now)).toThrow(ApiKeyExpiryError);
    expect(() => parseRequestedApiKeyExpiry('nope', now)).toThrow(ApiKeyExpiryError);
  });
});
