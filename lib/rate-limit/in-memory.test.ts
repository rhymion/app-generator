import { describe, it, expect, beforeEach } from 'vitest';

import { createInMemoryRateLimiter } from './in-memory';
import type { RateLimitBucketConfig } from './index';

const BUCKETS: Record<string, RateLimitBucketConfig> = {
  tight: { limit: 3, windowMs: 60_000 },
  loose: { limit: 10, windowMs: 60_000 },
};

function makeClock(start: number = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (next: number) => {
      t = next;
    },
  };
}

describe('createInMemoryRateLimiter', () => {
  let clock: ReturnType<typeof makeClock>;

  beforeEach(() => {
    clock = makeClock();
  });

  it('allows requests below the limit and reports remaining count', async () => {
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    const first = await limiter.check('tight', '1.1.1.1');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    expect(first.retryAfterSeconds).toBe(0);
  });

  it('denies the request that pushes past the limit with a sane Retry-After', async () => {
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    await limiter.check('tight', '1.1.1.1');
    await limiter.check('tight', '1.1.1.1');
    await limiter.check('tight', '1.1.1.1');
    clock.advance(1_000); // 1s into the 60s window

    const blocked = await limiter.check('tight', '1.1.1.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // The oldest timestamp was at t=0; the window closes at t=60_000 and we're
    // at 1_000, so 59s should be reported.
    expect(blocked.retryAfterSeconds).toBe(59);
  });

  it('admits a new request once the oldest timestamp ages out of the window', async () => {
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    await limiter.check('tight', '1.1.1.1'); // t=0
    clock.advance(10_000);
    await limiter.check('tight', '1.1.1.1'); // t=10_000
    clock.advance(10_000);
    await limiter.check('tight', '1.1.1.1'); // t=20_000

    // Next call denies because we already have 3 in the window.
    let next = await limiter.check('tight', '1.1.1.1');
    expect(next.allowed).toBe(false);

    // Advance just past t=60_000 from start so the first timestamp falls out.
    clock.advance(60_001 - 20_000);
    next = await limiter.check('tight', '1.1.1.1');
    expect(next.allowed).toBe(true);
  });

  it('isolates counters by bucket', async () => {
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    // Burn the tight bucket.
    for (let i = 0; i < 3; i++) await limiter.check('tight', '1.1.1.1');
    const tightDenied = await limiter.check('tight', '1.1.1.1');
    expect(tightDenied.allowed).toBe(false);

    // Same key on the loose bucket is still wide open.
    const loose = await limiter.check('loose', '1.1.1.1');
    expect(loose.allowed).toBe(true);
    expect(loose.remaining).toBe(9);
  });

  it('isolates counters by key', async () => {
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    for (let i = 0; i < 3; i++) await limiter.check('tight', '1.1.1.1');
    const other = await limiter.check('tight', '2.2.2.2');
    expect(other.allowed).toBe(true);
  });

  it('fails open for unknown buckets', async () => {
    // Unknown bucket name should not crash; current contract is allow + log.
    const limiter = createInMemoryRateLimiter(BUCKETS, clock.now);
    const decision = await limiter.check('not:a:real:bucket', '1.1.1.1');
    expect(decision.allowed).toBe(true);
  });
});
