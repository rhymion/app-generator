/**
 * POST /api/auth/password-reset/complete (Issue #1282). The token store is an in-memory
 * stand-in for the Auth.js VerificationToken table, so issue, peek, single use, expiry and
 * the kind prefix are exercised, not mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Row = { identifier: string; token: string; expires: Date };
type UserRow = { id: string; password: string | null; mfa_enabled: boolean; anonymized_at: Date | null };

const { tokens, users, userUpdate, sessionRevoke, verifyMfaCode, recordAuditEvent, clearFailedSignIns } = vi.hoisted(() => ({
  tokens: [] as Row[],
  users: new Map<string, UserRow>(),
  userUpdate: vi.fn(),
  sessionRevoke: vi.fn(),
  verifyMfaCode: vi.fn(),
  recordAuditEvent: vi.fn(),
  clearFailedSignIns: vi.fn(),
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
    update: userUpdate,
  };
  const mobile_session = { updateMany: sessionRevoke };
  const tx = { verificationToken, user, mobile_session };
  return { default: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});
vi.mock('@/lib/mfa/verify', () => ({ verifyMfaCode }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent }));
vi.mock('@/lib/auth/account-lockout', () => ({ clearFailedSignIns }));
vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());

import { _resetForTests } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/site-config';
import prisma from '@/lib/prisma';
import { issuePasswordResetToken, PASSWORD_RESET_TOKEN_TTL_MS } from '@/lib/auth/password-reset-token';
import { issueRegistrationToken } from '@/lib/auth/registration-token';
import { POST } from './route';

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;
const NEW_PASSWORD = 'correct horse battery';

let ipSeq = 0;
function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/password-reset/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${++ipSeq % 250}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetForTests();
  registration.emailVerification = true;
  tokens.length = 0;
  users.clear();
  users.set('a@example.com', { id: 'u1', password: '$2a$10$old', mfa_enabled: false, anonymized_at: null });
  users.set('m@example.com', { id: 'u2', password: '$2a$10$old', mfa_enabled: true, anonymized_at: null });
  for (const f of [userUpdate, sessionRevoke, verifyMfaCode, recordAuditEvent, clearFailedSignIns]) f.mockReset();
  userUpdate.mockResolvedValue({});
  sessionRevoke.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  registration.emailVerification = saved;
});

describe('POST /api/auth/password-reset/complete', () => {
  it('replaces the password with a bcrypt hash, revokes mobile sessions, audits and clears lockout', async () => {
    const token = await issuePasswordResetToken(prisma, 'a@example.com');
    const res = await POST(req({ token, password: NEW_PASSWORD }));
    expect(res.status).toBe(200);
    const data = userUpdate.mock.calls[0][0];
    expect(data.where).toEqual({ id: 'u1' });
    expect(data.data.password).toMatch(/^\$2[aby]\$/);
    expect(data.data.password).not.toBe(NEW_PASSWORD);
    expect(sessionRevoke).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 'u1', revoked_at: null } }));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth:passwordReset', actor_user_id: 'u1' }));
    expect(clearFailedSignIns).toHaveBeenCalledWith('a@example.com', expect.anything());
    expect(tokens).toHaveLength(0);
  });

  it('works once', async () => {
    const token = await issuePasswordResetToken(prisma, 'a@example.com');
    await POST(req({ token, password: NEW_PASSWORD }));
    const again = await POST(req({ token, password: NEW_PASSWORD }));
    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe('INVALID_TOKEN');
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired link, an unknown token and a sign-up token', async () => {
    const expired = await issuePasswordResetToken(prisma, 'a@example.com', new Date(Date.now() - PASSWORD_RESET_TOKEN_TTL_MS - 1000));
    const signUp = await issueRegistrationToken(prisma, 'a@example.com');
    for (const token of [expired, 'made-up', signUp]) {
      const res = await POST(req({ token, password: NEW_PASSWORD }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_TOKEN');
    }
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('keeps MFA in force: asks for a code, refuses a wrong one without burning the link, accepts a right one', async () => {
    const token = await issuePasswordResetToken(prisma, 'm@example.com');

    const missing = await POST(req({ token, password: NEW_PASSWORD }));
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('MFA_REQUIRED');

    verifyMfaCode.mockResolvedValueOnce(false);
    const wrong = await POST(req({ token, password: NEW_PASSWORD, mfaCode: '000000' }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe('INVALID_MFA_CODE');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(1);

    verifyMfaCode.mockResolvedValueOnce(true);
    const ok = await POST(req({ token, password: NEW_PASSWORD, mfaCode: '123456' }));
    expect(ok.status).toBe(200);
    expect(verifyMfaCode).toHaveBeenLastCalledWith('u2', '123456');
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses a weak password before using the link', async () => {
    const token = await issuePasswordResetToken(prisma, 'a@example.com');
    const res = await POST(req({ token, password: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('WEAK_PASSWORD');
    expect(tokens).toHaveLength(1);
  });

  it('refuses an erased account', async () => {
    users.set('a@example.com', { id: 'u1', password: '$2a$10$old', mfa_enabled: false, anonymized_at: new Date() });
    const token = await issuePasswordResetToken(prisma, 'a@example.com');
    const res = await POST(req({ token, password: NEW_PASSWORD }));
    expect(res.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('does not exist while email verification is off', async () => {
    registration.emailVerification = false;
    const res = await POST(req({ token: 'x', password: NEW_PASSWORD }));
    expect(res.status).toBe(404);
  });
});
