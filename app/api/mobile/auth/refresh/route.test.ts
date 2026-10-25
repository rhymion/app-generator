import { describe, it, expect, beforeEach, vi } from 'vitest';

const { findUnique, updateMany, update, signMobileAccessToken } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  signMobileAccessToken: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { mobile_session: { findUnique, updateMany, update } },
}));
// The real module pulls in next-auth; only the error shape matters here.
vi.mock('@/lib/api-auth', () => {
  class ApiError extends Error {
    constructor(
      public statusCode: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    handleApiError: (error: unknown) =>
      Response.json(
        { error: (error as Error).message },
        { status: error instanceof ApiError ? error.statusCode : 500 },
      ),
  };
});
vi.mock('@/lib/mobile-auth', () => ({
  ACCESS_TOKEN_TTL_SECONDS: 900,
  generateRefreshTokenPlaintext: () => 'new-refresh-token',
  hashRefreshToken: (s: string) => `hash:${s}`,
  signMobileAccessToken,
}));

import { POST } from './route';

function refreshRequest(refreshToken: string) {
  return new Request('http://localhost/api/mobile/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }) as unknown as Parameters<typeof POST>[0];
}

const liveSession = {
  id: 'session-1',
  user_id: 'user-1',
  revoked_at: null,
  expires_at: new Date(Date.now() + 60_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  signMobileAccessToken.mockResolvedValue('access-token');
});

// The Cypress example for a concurrent double refresh depends on request
// timing; these examples pin the same branches without it.
describe('POST /api/mobile/auth/refresh reuse handling', () => {
  it('revokes the whole session when the compare-and-swap matches no row (concurrent rotation won)', async () => {
    findUnique.mockResolvedValue(liveSession);
    updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(refreshRequest('old-token'));

    expect(res.status).toBe(401);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('answers 401 without revoking when the token matches no session (rotation already committed)', async () => {
    findUnique.mockResolvedValue(null);

    const res = await POST(refreshRequest('old-token'));

    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rotates the token and answers 200 when the compare-and-swap matches one row', async () => {
    findUnique.mockResolvedValue(liveSession);
    updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(refreshRequest('old-token'));

    expect(res.status).toBe(200);
    expect((await res.json()).refresh_token).toBe('new-refresh-token');
    expect(update).not.toHaveBeenCalled();
  });
});
