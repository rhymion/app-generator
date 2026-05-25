/**
 * Redis-backed rate limiter — sliding-window log across instances.
 *
 * Mirrors the algorithm in `in-memory.ts` but stores the per-(bucket, key)
 * timestamp log in a Redis sorted set so every replica sees the same counter.
 * Two atomicity-sensitive steps (trim expired entries, count remaining, then
 * conditionally add the new entry) run inside one Lua script so concurrent
 * requests against the same key can't race past the limit.
 *
 * Transport
 * ---------
 * `ioredis` over TCP. The same client talks to:
 *   - the Docker `redis:7-alpine` container started by `npm run docker:up:test`
 *     (see `docker-compose.test.yml`), used by Cypress E2E tests and Redis
 *     adapter unit tests. Dev omits Redis — `REDIS_URL` is unset in
 *     `.env.development`, so `getRateLimiter()` falls back to in-memory;
 *   - Upstash's TCP endpoint (`rediss://default:<token>@<host>:<port>`) when
 *     deployed on Vercel with Fluid Compute / the Node.js runtime;
 *   - any other managed Redis (ElastiCache, Memorystore, …) via the same URL
 *     scheme.
 *
 * Connection is picked from `REDIS_URL` and re-used across `check()` calls
 * via the singleton in `index.ts` (`getRateLimiter()`). ioredis handles
 * reconnection / backoff internally.
 *
 * Why not @upstash/ratelimit?
 * --------------------------
 * `@upstash/ratelimit` assumes the `@upstash/redis` REST client and would
 * need an SRH-style proxy in front of Docker Redis to run locally. The Lua
 * script below is short enough that a vanilla `ioredis` client keeps the
 * dependency surface smaller and works against any Redis without a proxy.
 */
import Redis, { type RedisOptions } from 'ioredis';

import type { RateLimitBucketConfig, RateLimitDecision, RateLimiter } from './index';

// Single round-trip: trim expired timestamps, count what remains, and either
// record this request or report when the next slot frees up. Returning a
// 4-tuple keeps the JS side branchless. Member uniqueness inside the sorted
// set is `<timestamp>:<callcount>` so two requests with identical `now`
// don't collapse onto the same ZSET member.
const SLIDING_WINDOW_LUA = `
local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local windowMs  = tonumber(ARGV[2])
local limit     = tonumber(ARGV[3])
local member    = ARGV[4]
local windowStart = now - windowMs

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  return {1, limit - count - 1, 0, now + windowMs}
end

-- ZRANGE 0 0 WITHSCORES returns [member, score].
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = tonumber(oldest[2])
local resetAt = oldestScore + windowMs
return {0, 0, math.max(0, resetAt - now), resetAt}
`;

export type CreateRedisRateLimiterOptions = {
  /** Pre-built ioredis client (used by tests / callers that own connection lifecycle). */
  client?: Redis;
  /** Override the connection URL. Falls back to `process.env.REDIS_URL`. */
  url?: string;
  /** Extra ioredis options merged in when constructing the client internally. */
  ioredisOptions?: RedisOptions;
};

export function createRedisRateLimiter(
  buckets: Record<string, RateLimitBucketConfig>,
  options: CreateRedisRateLimiterOptions = {},
): RateLimiter {
  const url = options.url ?? process.env.REDIS_URL;
  if (!options.client && !url) {
    throw new Error(
      'Redis rate-limit adapter requires REDIS_URL (or an injected client). ' +
        'Set REDIS_URL=redis://localhost:6379 for local Docker, or the provider URL in prod.',
    );
  }
  // `lazyConnect: true` defers the TCP dial until the first command so module
  // import order doesn't matter — useful inside Next.js middleware.
  const client =
    options.client ?? new Redis(url!, { lazyConnect: true, ...options.ioredisOptions });

  let callCounter = 0;

  return {
    async check(bucket: string, key: string): Promise<RateLimitDecision> {
      const cfg = buckets[bucket];
      if (!cfg) {
        // Same fail-open contract as the in-memory limiter: unknown bucket
        // names allow through with infinity remaining. Callers should
        // validate against DEFAULT_BUCKETS at startup if they want strict.
        return {
          allowed: true,
          remaining: Number.POSITIVE_INFINITY,
          retryAfterSeconds: 0,
          resetAt: Date.now(),
        };
      }

      const now = Date.now();
      // Disambiguate ZSET members written in the same millisecond.
      const member = `${now}:${++callCounter}`;
      const cacheKey = `rl:${bucket}:${key}`;

      const raw = (await client.eval(
        SLIDING_WINDOW_LUA,
        1,
        cacheKey,
        String(now),
        String(cfg.windowMs),
        String(cfg.limit),
        member,
      )) as [number, number, number, number];

      const [allowedNum, remaining, retryMs, resetAt] = raw;
      return {
        allowed: allowedNum === 1,
        remaining: Number(remaining),
        retryAfterSeconds: Math.ceil(Number(retryMs) / 1000),
        resetAt: Number(resetAt),
      };
    },
  };
}
