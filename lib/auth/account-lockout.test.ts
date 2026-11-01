import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());

import { _resetForTests, DEFAULT_BUCKETS } from '@/lib/rate-limit';
import { clearFailedSignIns, getAccountLockState, recordFailedSignIn } from './account-lockout';

const LIMIT = DEFAULT_BUCKETS['auth:account:lockout'].limit;

beforeEach(() => {
  _resetForTests();
  auditMock.mockReset();
});

describe('account lockout', () => {
  it('stays open below the failure threshold', async () => {
    for (let i = 0; i < LIMIT - 1; i++) await recordFailedSignIn('a@example.com');
    expect((await getAccountLockState('a@example.com')).locked).toBe(false);
  });

  it('locks the account once the threshold is reached, with a retry-after, and audits it once', async () => {
    for (let i = 0; i < LIMIT; i++) await recordFailedSignIn('a@example.com');
    const state = await getAccountLockState('a@example.com');
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    // Further failures while locked do not extend the lock or re-audit.
    await recordFailedSignIn('a@example.com');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auditMock.mock.calls[0][0])).not.toContain('a@example.com');
  });

  it('matches the email case-insensitively and leaves other accounts alone', async () => {
    for (let i = 0; i < LIMIT; i++) await recordFailedSignIn('A@Example.com ');
    expect((await getAccountLockState('a@example.com')).locked).toBe(true);
    expect((await getAccountLockState('b@example.com')).locked).toBe(false);
  });

  it('locks an email that has no account exactly like one that has', async () => {
    for (let i = 0; i < LIMIT; i++) await recordFailedSignIn('nobody@example.com');
    expect((await getAccountLockState('nobody@example.com')).locked).toBe(true);
  });

  it('a successful sign-in clears the failure count', async () => {
    for (let i = 0; i < LIMIT - 1; i++) await recordFailedSignIn('a@example.com');
    await clearFailedSignIns('a@example.com');
    await recordFailedSignIn('a@example.com');
    expect((await getAccountLockState('a@example.com')).locked).toBe(false);
  });

  it('peeking never counts as a failure', async () => {
    for (let i = 0; i < LIMIT * 3; i++) await getAccountLockState('a@example.com');
    expect((await getAccountLockState('a@example.com')).locked).toBe(false);
  });
});
