import { describe, expect, it, vi } from 'vitest';

const ctor = vi.hoisted(() => vi.fn());
vi.mock('ioredis', () => ({
  default: class FakeRedis {
    constructor(url: string, options: unknown) {
      ctor(url, options);
    }
  },
}));

import { createRedisRateLimiter } from './redis';

describe('createRedisRateLimiter internal client options (Issue #1176)', () => {
  it('bounds retries, backoff and timeouts so an unreachable Redis errors within seconds', () => {
    createRedisRateLimiter({}, { url: 'redis://127.0.0.1:6379', timeoutMs: 1_500 });

    const [, options] = ctor.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(options.lazyConnect).toBe(true);
    expect(options.connectTimeout).toBe(1_500);
    expect(options.commandTimeout).toBe(1_500);
    expect(options.maxRetriesPerRequest).toBe(1);
    const backoff = options.retryStrategy as (times: number) => number;
    expect(backoff(1)).toBeLessThanOrEqual(1_000);
    expect(backoff(50)).toBeLessThanOrEqual(1_000);
  });

  it('lets ioredisOptions override the defaults', () => {
    createRedisRateLimiter({}, { url: 'redis://x', ioredisOptions: { maxRetriesPerRequest: 3 } });
    const [, options] = ctor.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(options.maxRetriesPerRequest).toBe(3);
  });
});
