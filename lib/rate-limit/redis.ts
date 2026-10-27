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
import { createInMemoryRateLimiter } from './in-memory';

// Upper bound on how long one `check()` may wait on Redis before it is treated
// as a Redis failure (Issues #1176, #1178). ioredis' defaults (20 retries per
// command, backoff up to 2 s, 10 s connect timeout, queued commands) let an
// unreachable Redis hold a request for roughly 80 seconds; every auth path
// awaits the limiter first, so the failure path must be reached in seconds.
const DEFAULT_REDIS_TIMEOUT_MS = 2_000;
// After a Redis failure, skip Redis for this long and use the in-memory
// fallback directly, so a sustained outage costs one timeout per window
// instead of one per request.
const DEFAULT_REDIS_COOLDOWN_MS = 5_000;

const readPositiveMs = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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
  /** Max wait for one Redis check. Falls back to `RATE_LIMIT_REDIS_TIMEOUT_MS`, then 2000. */
  timeoutMs?: number;
  /** How long to bypass Redis after a failure. Falls back to `RATE_LIMIT_REDIS_COOLDOWN_MS`, then 5000. */
  cooldownMs?: number;
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
  const timeoutMs = options.timeoutMs ?? readPositiveMs(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS, DEFAULT_REDIS_TIMEOUT_MS);
  const cooldownMs = options.cooldownMs ?? readPositiveMs(process.env.RATE_LIMIT_REDIS_COOLDOWN_MS, DEFAULT_REDIS_COOLDOWN_MS);
  // `lazyConnect: true` defers the TCP dial until the first command so module
  // import order doesn't matter — useful inside Next.js middleware.
  // Short retry/backoff/timeouts so an unreachable Redis errors within about
  // `timeoutMs` instead of ioredis' default ~80 s (Issue #1176).
  const client =
    options.client ??
    new Redis(url!, {
      lazyConnect: true,
      connectTimeout: timeoutMs,
      commandTimeout: timeoutMs,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 1_000),
      ...options.ioredisOptions,
    });

  // Issue #1178: while Redis is failing (outage, or the provider's command
  // quota is exhausted and every command errors), checks fall back to a
  // per-process in-memory limiter with the same buckets instead of allowing
  // everything, so exhausting the external quota does not switch limiting off.
  // Per-process counters are weaker than the shared ones but bound each
  // instance's traffic.
  const fallback = createInMemoryRateLimiter(buckets);
  let redisDownUntil = 0;

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

      // Issue #587: an unreachable/erroring Redis must not take auth down
      // with it. The rate limiter is a defensive gate in front of auth, not
      // auth itself — availability outweighs the marginal brute-force
      // protection lost while Redis is down. Fail OPEN (the request is never
      // rejected because of the Redis fault itself), but never silently:
      // every failure is logged so the degraded window is visible in server
      // logs / audit tooling rather than only inferred after the fact from
      // an absence of 429s. Since Issue #1178 the degraded window is still
      // limited by the per-process in-memory fallback, and since Issue #1176
      // the failure is reached within `timeoutMs`.
      if (now < redisDownUntil) return fallback.check(bucket, key);

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = (await Promise.race([
          client.eval(
            SLIDING_WINDOW_LUA,
            1,
            cacheKey,
            String(now),
            String(cfg.windowMs),
            String(cfg.limit),
            member,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`rate-limit Redis check timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ])) as [number, number, number, number];

        const [allowedNum, remaining, retryMs, resetAt] = raw;
        return {
          allowed: allowedNum === 1,
          remaining: Number(remaining),
          retryAfterSeconds: Math.ceil(Number(retryMs) / 1000),
          resetAt: Number(resetAt),
        };
      } catch (err) {
        // Same "log and continue" contract as lib/audit-log.ts's DB-hiccup
        // handling: a broken Redis must never take auth down with it, but
        // the degraded window must be visible in server logs, not silent.
        redisDownUntil = Date.now() + cooldownMs;
        console.error(
          '[rate-limit:fail_open]',
          JSON.stringify({
            at: new Date().toISOString(),
            bucket,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return fallback.check(bucket, key);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
