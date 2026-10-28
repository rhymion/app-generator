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

  it('namespaces keys with keyPrefix, and with RATE_LIMIT_KEY_PREFIX when no option is given', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never, keyPrefix: 'preview:' });
    fake.enqueue([1, 2, 0, 9_999]);
    await limiter.check('tight', '1.1.1.1');
    expect(fake.calls[0].args[0]).toBe('rl:preview:tight:1.1.1.1');

    vi.stubEnv('RATE_LIMIT_KEY_PREFIX', 'production:');
    const envLimiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    fake.enqueue([1, 2, 0, 9_999]);
    await envLimiter.check('tight', '1.1.1.1');
    expect(fake.calls[1].args[0]).toBe('rl:production:tight:1.1.1.1');
    vi.unstubAllEnvs();
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

  it('does not reject and logs when Redis is unreachable (Issue #587)', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No decision enqueued — the fake client's `eval` throws, simulating an
    // unreachable Redis (connection refused / timeout).

    const decision = await limiter.check('tight', '1.1.1.1');

    // The Redis fault itself never rejects the request.
    expect(decision.allowed).toBe(true);

    // Never silent: the degraded window must be visible in server logs.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = errorSpy.mock.calls[0];
    expect(tag).toBe('[rate-limit:fail_open]');
    expect(JSON.parse(payload as string)).toMatchObject({ bucket: 'tight' });
  });

  it('enforces the bucket limit in memory while Redis is failing (Issue #1178)', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // `tight` allows 3 per window; every Redis call errors (e.g. exhausted provider quota).
    const decisions = [];
    for (let i = 0; i < 5; i++) decisions.push(await limiter.check('tight', '9.9.9.9'));

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions[3].retryAfterSeconds).toBeGreaterThan(0);
    // A different key is counted separately.
    expect((await limiter.check('tight', '8.8.8.8')).allowed).toBe(true);
  });

  it('skips Redis during the cooldown after a failure, then retries it', async () => {
    const fake = makeFakeClient();
    const limiter = createRedisRateLimiter(BUCKETS, { client: fake as never, cooldownMs: 5_000 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    await limiter.check('loose', '1.1.1.1'); // eval throws -> cooldown starts
    await limiter.check('loose', '1.1.1.1'); // inside cooldown -> no eval
    expect(fake.eval).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_700_000_006_000);
    fake.enqueue([1, 4, 0, 1_700_000_066_000]);
    const decision = await limiter.check('loose', '1.1.1.1');
    expect(fake.eval).toHaveBeenCalledTimes(2);
    expect(decision.remaining).toBe(4);
  });

  it('treats a hanging Redis as a failure after the timeout (Issue #1176)', async () => {
    vi.useFakeTimers();
    try {
      const hang = { eval: vi.fn(() => new Promise(() => {})) };
      const limiter = createRedisRateLimiter(BUCKETS, { client: hang as never, timeoutMs: 2_000 });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const pending = limiter.check('tight', '1.1.1.1');
      await vi.advanceTimersByTimeAsync(2_000);
      const decision = await pending;

      expect(decision.allowed).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][1])).toContain('timed out after 2000ms');
    } finally {
      vi.useRealTimers();
    }
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
