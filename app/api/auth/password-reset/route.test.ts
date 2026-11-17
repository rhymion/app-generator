// POST /api/auth/password-reset (Issue #1282): one answer for every address, a link only for a
// password account, nothing at all while email verification is off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { userFindUnique, tokenDeleteMany, tokenCreate, sendMail, mailConfigured } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenCreate: vi.fn(),
  sendMail: vi.fn(),
  mailConfigured: { value: true },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique },
    verificationToken: { deleteMany: tokenDeleteMany, create: tokenCreate },
  },
}));
vi.mock('@/lib/mail', () => ({ sendMail, isMailConfigured: () => mailConfigured.value }));
vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());

import { _resetForTests } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import { hashRegistrationToken } from '@/lib/auth/registration-token';
import { POST } from './route';

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;

let ipSeq = 0;
function req(body: Record<string, unknown>, ip = `203.0.113.${++ipSeq % 250}`) {
  return new Request('http://localhost/api/auth/password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetForTests();
  registration.emailVerification = true;
  mailConfigured.value = true;
  userFindUnique.mockReset().mockResolvedValue(null);
  tokenDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  tokenCreate.mockReset().mockResolvedValue({});
  sendMail.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  registration.emailVerification = saved;
});

describe('POST /api/auth/password-reset', () => {
  it('mails a link to a password account and stores only the hash of its token', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', password: '$2a$10$x', anonymized_at: null });
    const res = await POST(req({ email: 'a@example.com', locale: 'ja' }));
    expect(res.status).toBe(202);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('a@example.com');
    const raw = /token=([^\s&]+)/.exec(mail.text)![1];
    expect(mail.text).toContain('/ja/reset-password?token=');
    const stored = tokenCreate.mock.calls[0][0].data;
    expect(stored.identifier).toBe('password-reset:a@example.com');
    expect(stored.token).toBe(hashRegistrationToken(decodeURIComponent(raw)));
    expect(stored.token).not.toBe(raw);
  });

  it('answers the same 202 and sends nothing for an unknown, OAuth-only or erased account', async () => {
    const rows = [null, { id: 'u', password: null, anonymized_at: null }, { id: 'u', password: 'h', anonymized_at: new Date() }];
    for (const row of rows) {
      userFindUnique.mockResolvedValueOnce(row);
      const res = await POST(req({ email: 'x@example.com' }));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it('stops mailing one address after 3 requests an hour but still answers 202', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', password: 'h', anonymized_at: null });
    for (let i = 0; i < 4; i++) expect((await POST(req({ email: 'a@example.com' }))).status).toBe(202);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('limits requests per IP', async () => {
    for (let i = 0; i < 5; i++) await POST(req({ email: `u${i}@example.com` }, '192.0.2.10'));
    const blocked = await POST(req({ email: 'u6@example.com' }, '192.0.2.10'));
    expect(blocked.status).toBe(429);
  });

  it('answers 400 for a malformed address and 500 without a mail transport', async () => {
    expect((await POST(req({ email: 'nope' }))).status).toBe(400);
    mailConfigured.value = false;
    expect((await POST(req({ email: 'a@example.com' }))).status).toBe(500);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not exist while email verification is off', async () => {
    registration.emailVerification = false;
    const res = await POST(req({ email: 'a@example.com' }));
    expect(res.status).toBe(404);
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
