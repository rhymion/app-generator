/**
 * POST /api/auth/register/complete (Issue #1092): the second step of
 * self-registration with email verification. Runs the real token helpers
 * (lib/auth/registration-token.ts) against an in-memory VerificationToken table
 * so single use, expiry and replacement are exercised, not mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Row = { identifier: string; token: string; expires: Date };

const { tokens, users, userCreate } = vi.hoisted(() => ({
  tokens: [] as Row[],
  users: new Map<string, { id: string }>(),
  userCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const matches = (r: Row, where: { identifier?: string; token?: string; expires?: { gt: Date } }) =>
    (where.identifier === undefined || r.identifier === where.identifier) &&
    (where.token === undefined || r.token === where.token) &&
    (where.expires === undefined || r.expires > where.expires.gt);
  const verificationToken = {
    findUnique: async ({ where }: { where: { token: string } }) => tokens.find((r) => r.token === where.token) ?? null,
    create: async ({ data }: { data: Row }) => {
      tokens.push({ ...data });
      return data;
    },
    deleteMany: async ({ where }: { where: Parameters<typeof matches>[1] }) => {
      let count = 0;
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (matches(tokens[i], where)) {
          tokens.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
  };
  const user = {
    findUnique: async ({ where }: { where: { email: string } }) => users.get(where.email) ?? null,
    create: userCreate,
  };
  const client = { verificationToken, user, $transaction: async (fn: (tx: unknown) => unknown) => fn({ verificationToken, user }) };
  return { default: client };
});

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import prisma from '@/lib/prisma';
import { issueRegistrationToken, REGISTRATION_TOKEN_TTL_MS } from '@/lib/auth/registration-token';
import { POST } from './route';

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;
const GOOD_PASSWORD = 'correct horse battery';

let ipSeq = 0;
function completeRequest(body: Record<string, unknown>, ip = `198.51.100.${++ipSeq % 250}`) {
  return new Request('http://localhost/api/auth/register/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetForTests();
  registration.emailVerification = true;
  tokens.length = 0;
  users.clear();
  userCreate.mockReset().mockImplementation(async ({ data }: { data: { id: string; email: string } }) => {
    users.set(data.email, { id: data.id });
    return data;
  });
});

afterEach(() => {
  registration.emailVerification = saved;
  vi.useRealTimers();
});

describe('POST /api/auth/register/complete', () => {
  it('creates the account with a verified email and answers 201 with the address', async () => {
    const token = await issueRegistrationToken(prisma, 'new@example.com');

    const res = await POST(completeRequest({ token, name: 'New Person', password: GOOD_PASSWORD }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, email: 'new@example.com' });
    const data = userCreate.mock.calls[0][0].data;
    expect(data.email).toBe('new@example.com');
    expect(data.name).toBe('New Person');
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(data.password).not.toBe(GOOD_PASSWORD);
    expect(data.password).toMatch(/^\$2[aby]\$/);
    expect(tokens).toHaveLength(0);
  });

  it('works once: the same link a second time answers 400 INVALID_TOKEN', async () => {
    const token = await issueRegistrationToken(prisma, 'new@example.com');
    await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    const again = await POST(completeRequest({ token, name: 'B', password: GOOD_PASSWORD }));

    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe('INVALID_TOKEN');
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired link with the same answer and clears it', async () => {
    const issuedAt = new Date(Date.now() - REGISTRATION_TOKEN_TTL_MS - 1000);
    const token = await issueRegistrationToken(prisma, 'late@example.com', issuedAt);

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TOKEN');
    expect(userCreate).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(0);
  });

  it('refuses an unknown token and an earlier link replaced by a newer one', async () => {
    const first = await issueRegistrationToken(prisma, 'new@example.com');
    const second = await issueRegistrationToken(prisma, 'new@example.com');

    for (const token of ['made-up-token', first]) {
      const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_TOKEN');
    }
    const ok = await POST(completeRequest({ token: second, name: 'A', password: GOOD_PASSWORD }));
    expect(ok.status).toBe(201);
  });

  it('answers INVALID_TOKEN, not 409, when the address got an account in the meantime', async () => {
    const token = await issueRegistrationToken(prisma, 'raced@example.com');
    users.set('raced@example.com', { id: 'other' });

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TOKEN');
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rejects a weak password without using up the link', async () => {
    const token = await issueRegistrationToken(prisma, 'new@example.com');

    const weak = await POST(completeRequest({ token, name: 'A', password: 'short' }));
    expect(weak.status).toBe(400);
    expect((await weak.json()).code).toBe('WEAK_PASSWORD');
    expect(tokens).toHaveLength(1);

    const ok = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));
    expect(ok.status).toBe(201);
  });

  it('answers 400 for missing or malformed fields and writes nothing', async () => {
    const token = await issueRegistrationToken(prisma, 'new@example.com');
    for (const body of [
      { name: 'A', password: GOOD_PASSWORD },
      { token, name: 'A' },
      { token: 123, name: 'A', password: GOOD_PASSWORD },
      { token, name: 'x'.repeat(201), password: GOOD_PASSWORD },
    ]) {
      const res = await POST(completeRequest(body));
      expect(res.status).toBe(400);
    }
    expect(userCreate).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(1);
  });

  it('is limited to 10 attempts per IP in 10 minutes', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(completeRequest({ token: `guess-${i}`, name: 'A', password: GOOD_PASSWORD }, '203.0.113.99'));
      expect(res.status).toBe(400);
    }
    const blocked = await POST(completeRequest({ token: 'guess-x', name: 'A', password: GOOD_PASSWORD }, '203.0.113.99'));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('does not exist while email verification is off', async () => {
    registration.emailVerification = false;
    const token = await issueRegistrationToken(prisma, 'new@example.com');

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(404);
    expect(userCreate).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(1);
  });

  it('returns a generic body and logs no error message text on a database failure', async () => {
    const token = await issueRegistrationToken(prisma, 'new@example.com');
    const leaked = 'Invalid `prisma.user.create()` invocation: password: "$2a$10$abcdefghijklmnopqrstuv"';
    userCreate.mockRejectedValueOnce(Object.assign(new Error(leaked), { code: 'P2000' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Registration failed', code: 'REGISTRATION_FAILED' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('$2a$');
    errorSpy.mockRestore();
  });
});

describe('POST /api/auth/register/complete domain allow-list (Issue #1093)', () => {
  const auth = siteConfig.auth as { registrationAllowedDomains: string[] };
  const savedDomains = auth.registrationAllowedDomains;
  afterEach(() => {
    auth.registrationAllowedDomains = savedDomains;
  });

  it('refuses a link whose domain left the allow-list after it was sent, and creates nothing', async () => {
    const token = await issueRegistrationToken(prisma, 'late@other.com');
    auth.registrationAllowedDomains = ['example.com'];

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('REGISTRATION_NOT_ALLOWED');
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('completes a link for a listed domain', async () => {
    const token = await issueRegistrationToken(prisma, 'ok@example.com');
    auth.registrationAllowedDomains = ['example.com'];

    const res = await POST(completeRequest({ token, name: 'A', password: GOOD_PASSWORD }));

    expect(res.status).toBe(201);
  });
});
