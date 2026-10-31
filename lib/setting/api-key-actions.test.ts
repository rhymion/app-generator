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

import { getApiKeyStatus, issueApiKey } from './api-key-actions';
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
    update.mockResolvedValueOnce({ api_key_expires_at: null });

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

  it('keeps api_key_expires_at as it was', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: null });
    update.mockResolvedValueOnce({ api_key_expires_at: new Date('2030-01-01T00:00:00Z') });

    const { status } = await issueApiKey();

    expect(update.mock.calls[0][0].data).not.toHaveProperty('api_key_expires_at');
    expect(status.expiresAt).toBe('2030-01-01T00:00:00.000Z');
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

    expect(status).toEqual({ isSet: true, issuedAt: '2026-10-31T00:00:00.000Z', expiresAt: null });
    expect(JSON.stringify(status)).not.toContain('a'.repeat(64));
  });

  it('reports no key for an account without one', async () => {
    findUnique.mockResolvedValueOnce({ api_key_hash: null, api_key_issued_at: null, api_key_expires_at: null });
    expect((await getApiKeyStatus()).isSet).toBe(false);
  });
});
