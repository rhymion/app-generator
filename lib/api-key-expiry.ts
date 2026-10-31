import { siteConfig } from '@/lib/site-config';

/** Used when `siteConfig.auth.apiKeyDefaultExpiryDays` is removed. */
export const FALLBACK_API_KEY_EXPIRY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days a newly issued key lives by default: the site setting, the generator
 * default when the setting is absent, or `null` for "never expires" when the
 * setting is `null`.
 */
export function getDefaultApiKeyExpiryDays(): number | null {
  const configured = (siteConfig.auth as { apiKeyDefaultExpiryDays?: number | null }).apiKeyDefaultExpiryDays;
  if (configured === undefined) return FALLBACK_API_KEY_EXPIRY_DAYS;
  if (configured === null) return null;
  return Number.isFinite(configured) && configured > 0 ? configured : FALLBACK_API_KEY_EXPIRY_DAYS;
}

/** The default expiry for a key issued at `now`, or `null` when new keys never expire. */
export function getDefaultApiKeyExpiry(now: Date = new Date()): Date | null {
  const days = getDefaultApiKeyExpiryDays();
  return days === null ? null : new Date(now.getTime() + days * DAY_MS);
}

export class ApiKeyExpiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyExpiryError';
  }
}

/**
 * Validates an expiry chosen by the key's owner. `null` means "never expires".
 * Anything else must be an ISO date-time strictly in the future.
 */
export function parseRequestedApiKeyExpiry(value: string | null, now: Date = new Date()): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) {
    throw new ApiKeyExpiryError('The expiry is not a valid date.');
  }
  if (date.getTime() <= now.getTime()) {
    throw new ApiKeyExpiryError('The expiry must be in the future.');
  }
  return date;
}
