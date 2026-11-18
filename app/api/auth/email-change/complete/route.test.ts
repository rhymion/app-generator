/**
 * POST /api/auth/email-change/complete (Issue #1400). The token store is an in-memory stand-in
 * for the Auth.js VerificationToken table, so issue, single use, expiry, replacement and the kind
 * prefix are exercised, not mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Row = { identifier: string; token: string; expires: Date };
type UserRow = { id: string; email: string; anonymized_at: Date | null };
type TokenWhere = { identifier?: string | { startsWith: string }; token?: string; expires?: { gt: Date } };

const { tokens, users, userUpdate, recordAuditEvent, sendMail, webSessionDeleteMany, mobileSessionUpdateMany } = vi.hoisted(() => ({
  tokens: [] as Row[],
  users: [] as UserRow[],
  userUpdate: vi.fn(),
  recordAuditEvent: vi.fn(),
  sendMail: vi.fn(),
  webSessionDeleteMany: vi.fn(),
  mobileSessionUpdateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const matchesIdentifier = (value: string, cond: TokenWhere['identifier']) =>
    cond === undefined || (typeof cond === 'string' ? value === cond : value.startsWith(cond.startsWith));
  const matches = (r: Row, where: TokenWhere) =>
    matchesIdentifier(r.identifier, where.identifier) &&
    (where.token === undefined || r.token === where.token) &&
    (where.expires === undefined || r.expires > where.expires.gt);
  const verificationToken = {
    findUnique: async ({ where }: { where: { token: string } }) => tokens.find((r) => r.token === where.token) ?? null,
    create: async ({ data }: { data: Row }) => {
      tokens.push({ ...data });
      return data;
    },
    deleteMany: async ({ where }: { where: TokenWhere }) => {
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
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      users.find((u) => (where.id !== undefined ? u.id === where.id : u.email === where.email)) ?? null,
    update: userUpdate,
  };
  const tx = {
    verificationToken,
    user,
    web_session: { deleteMany: webSessionDeleteMany },
    mobile_session: { updateMany: mobileSessionUpdateMany },
  };
  return { default: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent }));
vi.mock('@/lib/mail', () => ({ sendMail, isMailConfigured: () => true }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());

import { _resetForTests } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import prisma from '@/lib/prisma';
import {
  issueEmailChangeCancelToken,
  issueEmailChangeToken,
  EMAIL_CHANGE_TOKEN_TTL_MS,
} from '@/lib/auth/email-change-token';
import { issueRegistrationToken } from '@/lib/auth/registration-token';
import { issuePasswordResetToken } from '@/lib/auth/password-reset-token';
import { POST } from './route';

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;

let ipSeq = 0;
function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/email-change/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${++ipSeq % 250}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetForTests();
  registration.emailVerification = true;
  tokens.length = 0;
  users.length = 0;
  users.push({ id: 'u1', email: 'old@example.com', anonymized_at: null });
  vi.clearAllMocks();
  webSessionDeleteMany.mockResolvedValue({ count: 2 });
  mobileSessionUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  registration.emailVerification = saved;
});

describe('POST /api/auth/email-change/complete', () => {
  it('does not exist while email verification is off', async () => {
    registration.emailVerification = false;
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    const res = await POST(req({ token }));
    expect(res.status).toBe(404);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('stores the new address, marked verified, and notifies the previous one', async () => {
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    const res = await POST(req({ token, locale: 'ja' }));
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = userUpdate.mock.calls[0][0];
    expect(where).toEqual({ id: 'u1' });
    expect(data.email).toBe('new@example.com');
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.com' }));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth:emailChange.complete', target_id: 'u1' }));
  });

  it('works once', async () => {
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    expect((await POST(req({ token }))).status).toBe(200);
    const again = await POST(req({ token }));
    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe('INVALID_TOKEN');
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired link', async () => {
    const issuedAt = new Date(Date.now() - EMAIL_CHANGE_TOKEN_TTL_MS - 1000);
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com', issuedAt);
    expect((await POST(req({ token }))).status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('honours only the newest link of an account', async () => {
    const first = await issueEmailChangeToken(prisma, 'u1', 'first@example.com');
    const second = await issueEmailChangeToken(prisma, 'u1', 'second@example.com');
    expect((await POST(req({ token: first }))).status).toBe(400);
    expect((await POST(req({ token: second }))).status).toBe(200);
    expect(userUpdate.mock.calls[0][0].data.email).toBe('second@example.com');
  });

  it('refuses a sign-up or password reset token', async () => {
    const signUp = await issueRegistrationToken(prisma, 'new@example.com');
    const reset = await issuePasswordResetToken(prisma, 'old@example.com');
    expect((await POST(req({ token: signUp }))).status).toBe(400);
    expect((await POST(req({ token: reset }))).status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('answers 409 when another account took the address after the link was sent', async () => {
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    users.push({ id: 'u2', email: 'new@example.com', anonymized_at: null });
    const res = await POST(req({ token }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('EMAIL_TAKEN');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('refuses the link of an erased account', async () => {
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    users[0].anonymized_at = new Date();
    expect((await POST(req({ token }))).status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed token', async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ token: 'x'.repeat(300) }))).status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('keeps the change when the notice to the previous address cannot be sent', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    expect((await POST(req({ token }))).status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it("ends the user's other sessions and removes the cancel link with the change", async () => {
    const token = await issueEmailChangeToken(prisma, 'u1', 'new@example.com');
    await issueEmailChangeCancelToken(prisma, 'u1');
    expect((await POST(req({ token }))).status).toBe(200);
    // No session cookie on this request: every web and mobile session of the user ends.
    expect(webSessionDeleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
    expect(mobileSessionUpdateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth:sessions.endOthers', target_id: 'u1', metadata: { web: 2, mobile: 1 },
    }));
    expect(tokens).toEqual([]);
  });

  it('ends no session when the link is refused', async () => {
    expect((await POST(req({ token: 'unknown' }))).status).toBe(400);
    expect(webSessionDeleteMany).not.toHaveBeenCalled();
    expect(mobileSessionUpdateMany).not.toHaveBeenCalled();
  });
});
