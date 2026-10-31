import { describe, it, expect, beforeEach, vi } from 'vitest';

const { findUnique, update, invalidateApiKeyCache, recordAuditEvent } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  invalidateApiKeyCache: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique, update } } }));
vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow: vi.fn(async () => 'session-user') }));
vi.mock('@/lib/api-auth', () => ({ invalidateApiKeyCache }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent }));

import { getApiKeyStatus, issueApiKey, setApiKeyExpiry } from './api-key-actions';
import { siteConfig } from '@/lib/site-config';
import { hashApiKey } from '@/lib/api-key';

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  invalidateApiKeyCache.mockReset();
  recordAuditEvent.mockReset();
});

describe('issueApiKey', () => {
  it('stores only the hash, returns the key once and drops the previous key from the cache', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: 'old-hash' });
    update.mockResolvedValueOnce({ api_key_hash: 'new-hash', api_key_issued_at: new Date(), api_key_expires_at: null });

    const { apiKey, status } = await issueApiKey();

    const data = update.mock.calls[0][0].data;
    expect(data.api_key_hash).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(update.mock.calls[0][0])).not.toContain(apiKey);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'session-user' });
    expect(invalidateApiKeyCache).toHaveBeenCalledWith('old-hash');
    expect(status.isSet).toBe(true);
    expect(JSON.stringify(status)).not.toContain(apiKey);
    expect(JSON.stringify(recordAuditEvent.mock.calls)).not.toContain(apiKey);
  });

  it('applies the site default expiry (90 days) to a new key when none is chosen', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: null });
    update.mockImplementationOnce(async ({ data }) => ({ api_key_hash: data.api_key_hash, api_key_issued_at: data.api_key_issued_at, api_key_expires_at: data.api_key_expires_at }));

    const { status } = await issueApiKey();

    const expiry = update.mock.calls[0][0].data.api_key_expires_at as Date;
    const days = (expiry.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    expect(status.expiresAt).toBe(expiry.toISOString());
  });

  it('applies no expiry when the site default is none', async () => {
    const auth = siteConfig.auth as { apiKeyDefaultExpiryDays: number | null };
    const saved = auth.apiKeyDefaultExpiryDays;
    auth.apiKeyDefaultExpiryDays = null;
    try {
      findUnique.mockResolvedValueOnce({ api_key_hash: null });
      update.mockResolvedValueOnce({ api_key_hash: 'h', api_key_issued_at: new Date(), api_key_expires_at: null });
      await issueApiKey();
      expect(update.mock.calls[0][0].data.api_key_expires_at).toBeNull();
    } finally {
      auth.apiKeyDefaultExpiryDays = saved;
    }
  });

  it('uses the expiry the owner chose, or none when they chose none', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    findUnique.mockResolvedValue({ api_key_hash: null });
    update.mockResolvedValue({ api_key_hash: 'h', api_key_issued_at: new Date(), api_key_expires_at: null });

    await issueApiKey({ expiresAt: future });
    expect((update.mock.calls[0][0].data.api_key_expires_at as Date).toISOString()).toBe(future);

    await issueApiKey({ expiresAt: null });
    expect(update.mock.calls[1][0].data.api_key_expires_at).toBeNull();
  });

  it('rejects a past or malformed expiry without touching the key', async () => {
    await expect(issueApiKey({ expiresAt: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/future/);
    await expect(issueApiKey({ expiresAt: 'not a date' })).rejects.toThrow(/valid date/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('setApiKeyExpiry', () => {
  it('changes the expiry of the session user\'s own key only and drops the cache entry', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    findUnique.mockResolvedValueOnce({ api_key_hash: 'cur-hash' });
    update.mockResolvedValueOnce({ api_key_hash: 'cur-hash', api_key_issued_at: null, api_key_expires_at: new Date(future) });

    const status = await setApiKeyExpiry(future);

    expect(update.mock.calls[0][0].where).toEqual({ id: 'session-user' });
    expect(update.mock.calls[0][0].data).toEqual({ api_key_expires_at: new Date(future) });
    expect(invalidateApiKeyCache).toHaveBeenCalledWith('cur-hash');
    expect(status.expiresAt).toBe(future);
  });

  it('clears the expiry with null', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: 'cur-hash' });
    update.mockResolvedValueOnce({ api_key_hash: 'cur-hash', api_key_issued_at: null, api_key_expires_at: null });
    const status = await setApiKeyExpiry(null);
    expect(update.mock.calls[0][0].data).toEqual({ api_key_expires_at: null });
    expect(status.expiresAt).toBeNull();
  });

  it('rejects a past date and an account without a key', async () => {
    await expect(setApiKeyExpiry(new Date(Date.now() - 1000).toISOString())).rejects.toThrow(/future/);
    findUnique.mockResolvedValueOnce({ api_key_hash: null });
    await expect(setApiKeyExpiry(null)).rejects.toThrow(/no API key/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('getApiKeyStatus', () => {
  it('reports whether a key is set and when, never the hash', async () => {
    findUnique.mockResolvedValueOnce({
      api_key_hash: 'a'.repeat(64),
      api_key_issued_at: new Date('2026-10-31T00:00:00Z'),
      api_key_expires_at: null,
    });

    const status = await getApiKeyStatus();

    expect(status).toEqual({ isSet: true, issuedAt: '2026-10-31T00:00:00.000Z', expiresAt: null, expired: false, defaultExpiryDays: 90 });
    expect(JSON.stringify(status)).not.toContain('a'.repeat(64));
  });

  it('reports an elapsed expiry as expired', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: 'h', api_key_issued_at: null, api_key_expires_at: new Date(Date.now() - 1000) });
    expect((await getApiKeyStatus()).expired).toBe(true);
  });

  it('reports no key for an account without one', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: null, api_key_issued_at: null, api_key_expires_at: null });
    expect((await getApiKeyStatus()).isSet).toBe(false);
  });
});
