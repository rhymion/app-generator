/**
 * POST /api/auth/email-change/cancel: the link in the notice to the current address removes the
 * pending email change. The token store is an in-memory stand-in for the Auth.js
 * VerificationToken table, so single use, expiry, replacement and the kind prefix are exercised.
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
import { POST } from './route';
import { POST as COMPLETE } from '../complete/route';

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;

let ipSeq = 0;
function req(path: string, body: Record<string, unknown>, ip = `198.51.100.${++ipSeq % 250}`) {
  return new Request(`http://localhost/api/auth/email-change/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

/** What startEmailChange() issues: the change link (new address) and the cancel link (current address). */
async function pendingChange(userId = 'u1', newEmail = 'new@example.com', at?: Date) {
  const change = await issueEmailChangeToken(prisma, userId, newEmail, at);
  const cancel = await issueEmailChangeCancelToken(prisma, userId, at);
  return { change, cancel };
}

beforeEach(() => {
  _resetForTests();
  registration.emailVerification = true;
  tokens.length = 0;
  users.length = 0;
  users.push({ id: 'u1', email: 'old@example.com', anonymized_at: null });
  users.push({ id: 'u2', email: 'other@example.com', anonymized_at: null });
  vi.clearAllMocks();
  webSessionDeleteMany.mockResolvedValue({ count: 0 });
  mobileSessionUpdateMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  registration.emailVerification = saved;
});

describe('POST /api/auth/email-change/cancel', () => {
  it('does not exist while email verification is off', async () => {
    registration.emailVerification = false;
    const { cancel } = await pendingChange();
    expect((await POST(req('cancel', { token: cancel }))).status).toBe(404);
    expect(tokens).toHaveLength(2);
  });

  it('removes the pending change, so its link no longer changes the address', async () => {
    const { change, cancel } = await pendingChange();
    const res = await POST(req('cancel', { token: cancel }));
    expect(res.status).toBe(200);
    expect(tokens).toEqual([]);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth:emailChange.cancel', target_id: 'u1' }));
    const completed = await COMPLETE(req('complete', { token: change }));
    expect(completed.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('works once', async () => {
    const { cancel } = await pendingChange();
    expect((await POST(req('cancel', { token: cancel }))).status).toBe(200);
    const again = await POST(req('cancel', { token: cancel }));
    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe('INVALID_TOKEN');
  });

  it('refuses once the change was completed', async () => {
    const { change, cancel } = await pendingChange();
    expect((await COMPLETE(req('complete', { token: change }))).status).toBe(200);
    expect((await POST(req('cancel', { token: cancel }))).status).toBe(400);
  });

  it('refuses an expired link and keeps nothing usable', async () => {
    const { change, cancel } = await pendingChange('u1', 'new@example.com', new Date(Date.now() - EMAIL_CHANGE_TOKEN_TTL_MS - 1000));
    expect((await POST(req('cancel', { token: cancel }))).status).toBe(400);
    expect((await COMPLETE(req('complete', { token: change }))).status).toBe(400);
  });

  it('honours only the cancel link of the newest request', async () => {
    const first = await pendingChange('u1', 'first@example.com');
    const second = await pendingChange('u1', 'second@example.com');
    expect((await POST(req('cancel', { token: first.cancel }))).status).toBe(400);
    // The newer change is still pending.
    expect((await COMPLETE(req('complete', { token: second.change }))).status).toBe(200);
  });

  // Security: the cancel token names the account; it cannot reach another account's change.
  it("cannot cancel another account's change: the token names the account", async () => {
    const mine = await pendingChange('u1', 'new@example.com');
    const theirs = await pendingChange('u2', 'their-new@example.com');
    expect((await POST(req('cancel', { token: mine.cancel }))).status).toBe(200);
    // u2's change is untouched and still completes.
    expect(tokens.filter((t) => t.identifier.includes(':u2'))).toHaveLength(2);
    expect((await COMPLETE(req('complete', { token: theirs.change }))).status).toBe(200);
    expect(userUpdate.mock.calls[0][0].where).toEqual({ id: 'u2' });
  });

  // Security: only a cancel token of this kind is accepted; refused attempts change nothing.
  it('refuses a change link, a sign-up token and an unknown token', async () => {
    const { change } = await pendingChange();
    const signUp = await issueRegistrationToken(prisma, 'someone@example.com');
    for (const token of [change, signUp, 'unknown']) {
      expect((await POST(req('cancel', { token }))).status).toBe(400);
    }
    // The pending change survived every refused attempt.
    expect(tokens.filter((t) => t.identifier.startsWith('email-change'))).toHaveLength(2);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses the link of an erased account', async () => {
    const { cancel } = await pendingChange();
    users[0].anonymized_at = new Date();
    expect((await POST(req('cancel', { token: cancel }))).status).toBe(400);
  });

  it('refuses a missing or malformed token', async () => {
    expect((await POST(req('cancel', {}))).status).toBe(400);
    expect((await POST(req('cancel', { token: 'x'.repeat(300) }))).status).toBe(400);
    expect((await POST(req('cancel', { token: 42 }))).status).toBe(400);
  });

  it('is rate limited per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await POST(req('cancel', { token: 'unknown' }, '192.0.2.9'))).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
