import { describe, it, expect, beforeEach, vi } from 'vitest';

const { authenticate, getSessionUserId, findMany, count } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getSessionUserId: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock('@/lib/authz', () => ({ getSessionUserId }));
vi.mock('@/lib/api-auth', () => ({
  authenticate,
  handleApiError: (e: unknown) => Response.json({ error: String(e) }, { status: 401 }),
}));
vi.mock('@/lib/prisma', () => ({ default: { notification: { findMany, count } } }));

import { GET } from './route';

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/notifications', { headers }) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  authenticate.mockReset();
  getSessionUserId.mockReset();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
});

describe('GET /api/notifications caller resolution', () => {
  it('resolves an X-API-Key through authenticate() instead of ignoring it for the session cookie', async () => {
    authenticate.mockResolvedValue({ userId: 'key-user' });
    getSessionUserId.mockResolvedValue('cookie-user');

    const res = await GET(req({ 'X-API-Key': 'mk_test' }));

    expect(res.status).toBe(200);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(getSessionUserId).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0]![0].where.user_id).toBe('key-user');
  });

  it('falls back to the session cookie without a credential header', async () => {
    getSessionUserId.mockResolvedValue('cookie-user');

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0]![0].where.user_id).toBe('cookie-user');
  });
});
