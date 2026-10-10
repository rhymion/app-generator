import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindFirst, requirePermission, verifyMobileAccessToken, getAuditLogPage, getAuditLogDetail } = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  requirePermission: vi.fn(),
  verifyMobileAccessToken: vi.fn(),
  getAuditLogPage: vi.fn(),
  getAuditLogDetail: vi.fn(),
}));

vi.mock('@/lib/mobile-auth', () => ({
  // Same shape test as production: a JWT has three dot-separated segments, an API key never does.
  isMobileJwt: (token: string) => token.split('.').length === 3,
  verifyMobileAccessToken,
  MobileAuthError: class MobileAuthError extends Error {},
}));
vi.mock('@/lib/prisma', () => ({ default: { user: { findFirst: userFindFirst } } }));
vi.mock('@/lib/authz', () => ({ requirePermission, getSessionUserId: vi.fn() }));
vi.mock('@/lib/audit_log/getters', () => ({ getAuditLogPage, getAuditLogDetail }));

import { NextRequest } from 'next/server';
import { GET as listRoute } from './route';
import { GET as detailRoute } from './[id]/route';

const MOBILE_JWT = 'header.payload.signature';

function request(path: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  userFindFirst.mockReset();
  requirePermission.mockReset().mockResolvedValue({ general: {} });
  verifyMobileAccessToken.mockReset();
  getAuditLogPage.mockReset().mockResolvedValue({ rows: [], total: 0, page: 0, pageSize: 20 });
  getAuditLogDetail.mockReset().mockResolvedValue({ id: 'a1' });
});

// The mobile app sends its access token as `Authorization: Bearer <jwt>` (lib/api-base.ts).
describe('GET /api/audit_log', () => {
  it('accepts a mobile access token, like every generated entity list route', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', sessionId: 's1' });
    const res = await listRoute(request('/api/audit_log?page=0&pageSize=20&sort=created_at:desc', { Authorization: `Bearer ${MOBILE_JWT}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], total: 0, page: 0, pageSize: 20 });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith('audit_log', 'read', undefined, 'user-1');
  });

  it('still accepts a service API key', async () => {
    userFindFirst.mockResolvedValue({ id: 'user-2', api_key_expires_at: null });
    const res = await listRoute(request('/api/audit_log', { 'X-API-Key': 'plain-key' }));
    expect(res.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith('audit_log', 'read', undefined, 'user-2');
  });

  it('rejects an invalid mobile access token with 401', async () => {
    verifyMobileAccessToken.mockRejectedValue(new Error('bad token'));
    const res = await listRoute(request('/api/audit_log', { Authorization: `Bearer ${MOBILE_JWT}` }));
    expect(res.status).toBe(401);
    expect(getAuditLogPage).not.toHaveBeenCalled();
  });

  it('answers 403 when the mobile caller lacks read on audit_log', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', sessionId: 's1' });
    requirePermission.mockRejectedValue(new Error('Permission denied'));
    const res = await listRoute(request('/api/audit_log', { Authorization: `Bearer ${MOBILE_JWT}` }));
    expect(res.status).toBe(403);
    expect(getAuditLogPage).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit_log/[id]', () => {
  it('accepts a mobile access token', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', sessionId: 's1' });
    const res = await detailRoute(request('/api/audit_log/a1', { Authorization: `Bearer ${MOBILE_JWT}` }), {
      params: Promise.resolve({ id: 'a1' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a1' });
  });

  it('rejects a request with no credentials with 401', async () => {
    const res = await detailRoute(request('/api/audit_log/a1', {}), { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(401);
  });
});
