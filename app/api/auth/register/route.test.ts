import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { userFindUnique, userCreate, tokenDeleteMany, tokenCreate, sendMail, mailConfigured } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenCreate: vi.fn(),
  sendMail: vi.fn(),
  mailConfigured: { value: true },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique, create: userCreate },
    verificationToken: { deleteMany: tokenDeleteMany, create: tokenCreate },
  },
}));

vi.mock('@/lib/mail', () => ({
  sendMail,
  isMailConfigured: () => mailConfigured.value,
}));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import { hashRegistrationToken } from '@/lib/auth/registration-token';
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

describe('POST /api/auth/register password strength', () => {
  it('answers 400 for a password under the minimum length and creates nothing', async () => {
    const res = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.50' },
        body: JSON.stringify({ email: 'weak@example.com', password: 'short' }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('WEAK_PASSWORD');
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/register unexpected failure', () => {
  it('returns a generic body and logs no error message text', async () => {
    const leaked = 'Invalid `prisma.user.create()` invocation: password: "$2a$10$abcdefghijklmnopqrstuv"';
    userCreate.mockRejectedValueOnce(Object.assign(new Error(leaked), { code: 'P2000' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(registerRequest('203.0.113.7'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Registration failed', code: 'REGISTRATION_FAILED' });
    expect(JSON.stringify(body)).not.toContain('$2a$');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('$2a$');
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('P2000');
    errorSpy.mockRestore();
  });
});

describe('POST /api/auth/register client address', () => {
  it('cannot be reset by rotating a client-supplied X-Forwarded-For prefix', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(registerRequest(`10.0.0.${i}, 203.0.113.7`, `u${i}@example.com`));
      expect(res.status).toBe(201);
    }

    const blocked = await POST(registerRequest('10.9.9.9, 203.0.113.7', 'u6@example.com'));

    expect(blocked.status).toBe(429);
  });
});

describe('POST /api/auth/register with email verification on (Issue #1092)', () => {
  const registration = siteConfig.auth.registration as { emailVerification: boolean };
  const saved = registration.emailVerification;

  function linkRequest(email: string, ip = '203.0.113.80', extra: Record<string, unknown> = {}) {
    return new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, ...extra }),
    });
  }

  beforeEach(() => {
    registration.emailVerification = true;
    mailConfigured.value = true;
    tokenDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    tokenCreate.mockReset().mockResolvedValue({});
    sendMail.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    registration.emailVerification = saved;
  });

  it('answers the same 202 for a new and an already registered address', async () => {
    const fresh = await POST(linkRequest('new@example.com', '203.0.113.81'));
    userFindUnique.mockResolvedValueOnce({ id: 'u1' });
    const taken = await POST(linkRequest('taken@example.com', '203.0.113.82'));

    expect(fresh.status).toBe(202);
    expect(taken.status).toBe(202);
    expect(await fresh.json()).toEqual(await taken.json());
    expect(fresh.headers.get('content-type')).toBe(taken.headers.get('content-type'));
  });

  it('creates no account, even when a name and password are sent', async () => {
    const res = await POST(linkRequest('new@example.com', '203.0.113.83', { name: 'N', password: 'Passw0rd!long' }));

    expect(res.status).toBe(202);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('mails a sign-up link to a new address and stores only the hash of its token', async () => {
    await POST(linkRequest('new@example.com', '203.0.113.84', { locale: 'ja' }));

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe('new@example.com');
    const link = /https?:\/\/\S+\/ja\/register\/complete\?token=(\S+)/.exec(message.text);
    expect(link).not.toBeNull();
    const token = decodeURIComponent(link![1]);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const stored = tokenCreate.mock.calls[0][0].data;
    expect(stored.identifier).toBe('registration:new@example.com');
    expect(stored.token).toBe(hashRegistrationToken(token));
    expect(stored.token).not.toContain(token);
    expect(stored.expires.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    // An earlier link for the same address stops working.
    expect(tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: 'registration:new@example.com' } });
  });

  it('mails an existing account holder a notice with no link and issues no token', async () => {
    userFindUnique.mockResolvedValueOnce({ id: 'u1' });

    await POST(linkRequest('taken@example.com', '203.0.113.85'));

    expect(tokenCreate).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe('taken@example.com');
    expect(message.text).not.toMatch(/register\/complete/);
    expect(message.text).toMatch(/\/en\/login/);
  });

  it('builds the link from a configured host, never from an unchecked Host header', async () => {
    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.86',
        'x-forwarded-host': 'evil.example',
        host: 'evil.example',
      },
      body: JSON.stringify({ email: 'new@example.com' }),
    });

    await POST(req);

    expect(sendMail.mock.calls[0][0].text).not.toContain('evil.example');
  });

  it('stops mailing one address after 3 requests an hour but still answers 202', async () => {
    for (let i = 0; i < 3; i++) await POST(linkRequest('victim@example.com', `198.51.100.${i + 10}`));
    const fourth = await POST(linkRequest('victim@example.com', '198.51.100.20'));

    expect(fourth.status).toBe(202);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('answers 400 for a missing or malformed address and sends nothing', async () => {
    for (const email of ['', 'not-an-address', 'a'.repeat(400) + '@example.com']) {
      const res = await POST(linkRequest(email, '192.0.2.10'));
      expect(res.status).toBe(400);
    }
    _resetForTests();
    const res = await POST(new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.11' },
      body: JSON.stringify({ email: 42 }),
    }));
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when no mail transport is configured', async () => {
    mailConfigured.value = false;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(linkRequest('new@example.com', '203.0.113.87'));

    expect(res.status).toBe(500);
    expect(tokenCreate).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('keeps the per-IP ceiling', async () => {
    for (let i = 0; i < 5; i++) await POST(linkRequest(`u${i}@example.com`, '203.0.113.88'));
    const blocked = await POST(linkRequest('u6@example.com', '203.0.113.88'));
    expect(blocked.status).toBe(429);
  });
});

describe('POST /api/auth/register domain allow-list (Issue #1093)', () => {
  const auth = siteConfig.auth as { registrationAllowedDomains: string[]; registration: { emailVerification: boolean } };
  const savedDomains = auth.registrationAllowedDomains;
  const savedVerification = auth.registration.emailVerification;

  function req(body: Record<string, unknown>, ip: string) {
    return new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    auth.registrationAllowedDomains = ['Example.com'];
    sendMail.mockReset().mockResolvedValue(undefined);
    tokenDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    tokenCreate.mockReset().mockResolvedValue({});
    mailConfigured.value = true;
  });

  afterEach(() => {
    auth.registrationAllowedDomains = savedDomains;
    auth.registration.emailVerification = savedVerification;
  });

  it('accepts a listed domain, case-insensitively', async () => {
    const res = await POST(req({ email: 'a@EXAMPLE.com', password: 'Passw0rd!' }, '203.0.113.90'));
    expect(res.status).toBe(201);
  });

  it('refuses another domain or a subdomain with a generic 403 and creates nothing', async () => {
    for (const [i, email] of ['a@other.com', 'a@sub.example.com', 'a@example.com.evil.net'].entries()) {
      const res = await POST(req({ email, password: 'Passw0rd!' }, `203.0.113.${91 + i}`));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('REGISTRATION_NOT_ALLOWED');
      expect(JSON.stringify(body)).not.toContain('example.com');
    }
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('with email verification on, refuses before any token or mail', async () => {
    auth.registration.emailVerification = true;
    const res = await POST(req({ email: 'a@other.com' }, '203.0.113.95'));
    expect(res.status).toBe(403);
    expect(tokenCreate).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    const ok = await POST(req({ email: 'b@example.com' }, '203.0.113.96'));
    expect(ok.status).toBe(202);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('allows every address while the list is empty', async () => {
    auth.registrationAllowedDomains = [];
    const res = await POST(req({ email: 'a@anywhere.org', password: 'Passw0rd!' }, '203.0.113.97'));
    expect(res.status).toBe(201);
  });
});
