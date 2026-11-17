import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());

import { _resetForTests, DEFAULT_BUCKETS } from '@/lib/rate-limit';
import { clearFailedSignIns, getAccountLockState, recordFailedSignIn } from './account-lockout';

const TIER1 = DEFAULT_BUCKETS['auth:account:lockout'];
const TIER2 = DEFAULT_BUCKETS['auth:account:lockout:email'];
const OWNER = 'a@example.com';

/** Headers as the platform edge would deliver them for a given client address. */
function from(ip: string): Headers {
  return new Headers({ 'x-forwarded-for': ip });
}

async function fail(email: string, headers: Headers, times: number) {
  for (let i = 0; i < times; i++) await recordFailedSignIn(email, headers);
}

beforeEach(() => {
  _resetForTests();
  auditMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('account lockout, tier 1 (email x source address)', () => {
  it('has a per-address threshold well below the email-wide ceiling', () => {
    expect(TIER1.limit).toBe(10);
    expect(TIER1.windowMs).toBe(15 * 60_000);
    expect(TIER2.limit).toBeGreaterThan(TIER1.limit);
  });

  it('stays open below the failure threshold', async () => {
    await fail(OWNER, from('198.51.100.1'), TIER1.limit - 1);
    expect((await getAccountLockState(OWNER, from('198.51.100.1'))).locked).toBe(false);
  });

  it('locks the email from that address after the threshold, with a retry-after, and audits it once', async () => {
    const ip = from('198.51.100.1');
    await fail(OWNER, ip, TIER1.limit);
    const state = await getAccountLockState(OWNER, ip);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    await recordFailedSignIn(OWNER, ip);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auditMock.mock.calls[0][0])).not.toContain(OWNER);
    expect(JSON.stringify(auditMock.mock.calls[0][0])).not.toContain('198.51.100.1');
  });

  it("failures from another address do not lock the owner's address", async () => {
    await fail(OWNER, from('203.0.113.50'), TIER1.limit * 3);
    expect((await getAccountLockState(OWNER, from('203.0.113.50'))).locked).toBe(true);
    expect((await getAccountLockState(OWNER, from('198.51.100.1'))).locked).toBe(false);
  });

  it('matches the email case-insensitively and leaves other emails alone', async () => {
    const ip = from('198.51.100.1');
    await fail('A@Example.com ', ip, TIER1.limit);
    expect((await getAccountLockState(OWNER, ip)).locked).toBe(true);
    expect((await getAccountLockState('b@example.com', ip)).locked).toBe(false);
  });

  it('locks an email that has no account exactly like one that has', async () => {
    const ip = from('198.51.100.1');
    await fail('nobody@example.com', ip, TIER1.limit);
    expect((await getAccountLockState('nobody@example.com', ip)).locked).toBe(true);
  });

  it('a successful sign-in clears the count for that email and address', async () => {
    const ip = from('198.51.100.1');
    await fail(OWNER, ip, TIER1.limit - 1);
    await clearFailedSignIns(OWNER, ip);
    await recordFailedSignIn(OWNER, ip);
    expect((await getAccountLockState(OWNER, ip)).locked).toBe(false);
  });

  it('peeking never counts as a failure', async () => {
    for (let i = 0; i < TIER1.limit * 3; i++) await getAccountLockState(OWNER, from('198.51.100.1'));
    expect((await getAccountLockState(OWNER, from('198.51.100.1'))).locked).toBe(false);
  });

  it('unlocks when the window has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const ip = from('198.51.100.1');
    await fail(OWNER, ip, TIER1.limit);
    expect((await getAccountLockState(OWNER, ip)).locked).toBe(true);
    vi.setSystemTime(new Date(Date.now() + TIER1.windowMs + 1_000));
    expect((await getAccountLockState(OWNER, ip)).locked).toBe(false);
  });
});

describe('account lockout, tier 2 (email across all addresses)', () => {
  it('stops guessing spread over many addresses once the email-wide ceiling is spent', async () => {
    // Two failures per address stay far below tier 1 everywhere.
    for (let i = 0; i < TIER2.limit; i++) await recordFailedSignIn(OWNER, from(`10.0.${Math.floor(i / 250)}.${i % 250}`));
    const owner = await getAccountLockState(OWNER, from('198.51.100.1'));
    expect(owner.locked).toBe(true);
    expect(owner.retryAfterSeconds).toBeGreaterThan(0);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0].metadata.tier).toBe('email');
  });

  it('is still stopped when a spoofable header gives every attempt a fresh address', async () => {
    // Left-most X-Forwarded-For entries are client controlled; with one trusted hop the
    // right-most entry is used, so only a deployment that trusts a client-set address
    // (here modelled by X-Real-IP with no X-Forwarded-For) yields a new tier-1 key per request.
    for (let i = 0; i < TIER2.limit; i++) {
      await recordFailedSignIn(OWNER, new Headers({ 'x-real-ip': `192.0.2.${i}-${i}` }));
    }
    expect((await getAccountLockState(OWNER, new Headers({ 'x-real-ip': 'fresh' }))).locked).toBe(true);
  });

  it('does not lock other emails', async () => {
    for (let i = 0; i < TIER2.limit; i++) await recordFailedSignIn(OWNER, from(`10.0.0.${i % 250}-${i}`));
    expect((await getAccountLockState('b@example.com', from('198.51.100.1'))).locked).toBe(false);
  });

  it('is cleared by a successful sign-in, together with the count for that address', async () => {
    for (let i = 0; i < TIER2.limit - 1; i++) await recordFailedSignIn(OWNER, from(`10.1.0.${i % 250}-${i}`));
    await clearFailedSignIns(OWNER, from('198.51.100.1'));
    await recordFailedSignIn(OWNER, from('198.51.100.2'));
    expect((await getAccountLockState(OWNER, from('198.51.100.3'))).locked).toBe(false);
  });

  it('unlocks when the window has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (let i = 0; i < TIER2.limit; i++) await recordFailedSignIn(OWNER, from(`10.2.0.${i % 250}-${i}`));
    expect((await getAccountLockState(OWNER, from('198.51.100.1'))).locked).toBe(true);
    vi.setSystemTime(new Date(Date.now() + TIER2.windowMs + 1_000));
    expect((await getAccountLockState(OWNER, from('198.51.100.1'))).locked).toBe(false);
  });
});
