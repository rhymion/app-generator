import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRedisRateLimiter } from './redis';
import type { RateLimitBucketConfig } from './index';

const BUCKETS: Record<string, RateLimitBucketConfig> = {
  tight: { limit: 3, windowMs: 60_000 },
  loose: { limit: 10, windowMs: 60_000 },
};

// Minimal fake ioredis client. We only exercise `eval`, which is what the
// adapter calls. Each test pre-configures the next return tuple.
function makeFakeClient() {
  const calls: Array<{ script: string; numKeys: number; args: string[] }> = [];
  const queue: Array<[number, number, number, number]> = [];
  return {
    calls,
    enqueue(decision: [number, number, number, number]) {
      queue.push(decision);
    },
    eval: vi.fn(async (script: string, numKeys: number, ...args: string[]) => {
      calls.push({ script, numKeys, args });
      const next = queue.shift();
      if (!next) throw new Error('fake-redis: no enqueued decision for eval call');
      return next;
    }),
  };
}

describe('createRedisRateLimiter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes bucket window/limit and the cache key to the Lua script', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    fake.enqueue([1, 2, 0, 9_999]);

    await limiter.check('tight', '1.1.1.1');

    expect(fake.calls).toHaveLength(1);
    const [{ numKeys, args }] = fake.calls;
    expect(numKeys).toBe(1);
    // ARGS layout: [cacheKey, now, windowMs, limit, member]
    expect(args[0]).toBe('rl:tight:1.1.1.1');
    expect(args[2]).toBe('60000');
    expect(args[3]).toBe('3');
    expect(args[4]).toMatch(/^\d+:\d+$/);
  });

  it('maps an allow tuple into a RateLimitDecision', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    const resetAt = Date.now() + 60_000;
    fake.enqueue([1, 5, 0, resetAt]);

    const decision = await limiter.check('loose', '1.2.3.4');

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(5);
    expect(decision.retryAfterSeconds).toBe(0);
    expect(decision.resetAt).toBe(resetAt);
  });

  it('maps a deny tuple and rounds retryAfter up to whole seconds', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    // Script reports retry in 12_345 ms → 13 seconds rounded up.
    const resetAt = Date.now() + 12_345;
    fake.enqueue([0, 0, 12_345, resetAt]);

    const decision = await limiter.check('tight', '1.1.1.1');

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBe(13);
    expect(decision.resetAt).toBe(resetAt);
  });

  it('uses unique members on rapid consecutive checks (same millisecond)', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    // Freeze Date.now() so both calls land in the same millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    fake.enqueue([1, 2, 0, 1_700_000_060_000]);
    fake.enqueue([1, 1, 0, 1_700_000_060_000]);

    await limiter.check('tight', '1.1.1.1');
    await limiter.check('tight', '1.1.1.1');

    const memberA = fake.calls[0].args[4];
    const memberB = fake.calls[1].args[4];
    expect(memberA).not.toBe(memberB);
  });

  it('fails open for unknown buckets without touching Redis', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });

    const decision = await limiter.check('not:a:real:bucket', '1.1.1.1');

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(fake.eval).not.toHaveBeenCalled();
  });

  it('throws at construction when neither client nor REDIS_URL is provided', () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(() => createRedisRateLimiter(BUCKETS)).toThrow(/REDIS_URL/);
    } finally {
      if (previous !== undefined) process.env.REDIS_URL = previous;
    }
  });
});
