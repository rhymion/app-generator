import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique, userCreate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: userFindUnique, create: userCreate } },
}));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests } from '@/lib/rate-limit';
import { POST } from './route';

function registerRequest(ip: string, email = 'new@example.com') {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password: 'Passw0rd!' }),
  });
}

beforeEach(() => {
  _resetForTests();
  userFindUnique.mockReset();
  userCreate.mockReset();
  userFindUnique.mockResolvedValue(null);
  userCreate.mockResolvedValue({});
});

describe('POST /api/auth/register rate limit', () => {
  it('answers 429 with Retry-After once an IP exceeds 5 requests in the window', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(registerRequest('203.0.113.7', `u${i}@example.com`));
      expect(res.status).toBe(201);
    }

    const blocked = await POST(registerRequest('203.0.113.7', 'u6@example.com'));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The blocked request never reaches the database.
    expect(userCreate).toHaveBeenCalledTimes(5);
  });

  it('counts each IP separately', async () => {
    for (let i = 0; i < 5; i++) await POST(registerRequest('203.0.113.7'));

    const other = await POST(registerRequest('198.51.100.9'));

    expect(other.status).toBe(201);
  });

  it('keeps the existing 409 for an email that is already registered', async () => {
    userFindUnique.mockResolvedValueOnce({ id: 'u1' });

    const res = await POST(registerRequest('203.0.113.7'));

    expect(res.status).toBe(409);
  });
});
