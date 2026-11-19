/**
 * startEmailChange() (Issue #1400): the settings save with email verification on mails a link to
 * the new address and a notice to the current one, and stores nothing on the account.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tokenCreate, tokenDeleteMany, userFindUnique, userUpdate, sendMail, recordAuditEvent, check } = vi.hoisted(() => ({
  tokenCreate: vi.fn(),
  tokenDeleteMany: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  sendMail: vi.fn(),
  recordAuditEvent: vi.fn(),
  check: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    verificationToken: { create: tokenCreate, deleteMany: tokenDeleteMany },
    user: { findUnique: userFindUnique, update: userUpdate },
  },
}));
vi.mock('@/lib/mail', () => ({ sendMail }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent }));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }));

import { startEmailChange } from './email-change';

const input = { userId: 'u1', currentEmail: 'old@example.com', newEmail: ' new@example.com ' };

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue(null);
  check.mockResolvedValue({ allowed: true });
  tokenDeleteMany.mockResolvedValue({ count: 0 });
});

describe('startEmailChange', () => {
  it('mails a link to the new address and a notice to the current one, and never writes the account', async () => {
    await startEmailChange(input);
    expect(tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: { startsWith: 'email-change:u1:' } } });
    expect(tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: 'email-change-cancel:u1' } });
    expect(tokenCreate.mock.calls[0][0].data.identifier).toBe('email-change:u1:new@example.com');
    expect(tokenCreate.mock.calls[1][0].data.identifier).toBe('email-change-cancel:u1');
    expect(sendMail).toHaveBeenCalledTimes(2);
    const [link, notice] = sendMail.mock.calls.map((c) => c[0]);
    expect(link.to).toBe('new@example.com');
    expect(link.text).toMatch(/http:\/\/localhost:3000\/ja\/confirm-email\?token=/);
    expect(notice.to).toBe('old@example.com');
    expect(notice.text).not.toContain('new@example.com');
    // The notice carries a link that cancels the change.
    expect(notice.text).toMatch(/http:\/\/localhost:3000\/ja\/cancel-email-change\?token=[A-Za-z0-9_-]{43}/);
    // The two links are different tokens.
    const confirmToken = /token=([A-Za-z0-9_-]+)/.exec(link.text)?.[1];
    const cancelToken = /token=([A-Za-z0-9_-]+)/.exec(notice.text)?.[1];
    expect(confirmToken).not.toBe(cancelToken);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith('auth:register:email', expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('sends nothing when the new address belongs to another account', async () => {
    userFindUnique.mockResolvedValue({ id: 'u2' });
    await startEmailChange(input);
    expect(sendMail).not.toHaveBeenCalled();
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it('sends nothing once the per-address mail budget is spent', async () => {
    check.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    await startEmailChange(input);
    expect(sendMail).not.toHaveBeenCalled();
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it('ignores an address that is not one', async () => {
    await startEmailChange({ ...input, newEmail: 'not-an-address' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
