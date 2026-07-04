/**
 * Rate limiting — entry point.
 *
 * This module deliberately exposes a small `RateLimiter` interface so the
 * implementation can be swapped from in-memory (current default, fine for
 * single-instance dev and Cypress) to a distributed store (Upstash Redis,
 * Vercel KV) without touching callers.
 *
 * Buckets
 * -------
 * Calls are scoped by a named *bucket* so different auth surfaces can have
 * different ceilings without bleeding into each other. The default
 * configuration in `DEFAULT_BUCKETS` covers the three surfaces called out in
 * the S1 ticket:
 *
 *   - `auth:signin:credentials` — credential sign-in attempts
 *   - `auth:signin:provider`    — OAuth sign-in starts (button click)
 *   - `auth:callback`           — OAuth callback handling
 *
 * The key inside each bucket is whatever uniquely identifies the abuser —
 * today, the caller's IP. Future enhancements (per-account ceilings, per-email
 * brute-force tracking) can layer additional buckets without changing the
 * interface.
 *
 * Choosing the implementation
 * ---------------------------
 * `getRateLimiter()` picks the best implementation available:
 *
 *   1. If `REDIS_URL` is set, the Redis adapter (`./redis.ts`) is selected.
 *      Talks TCP via `ioredis` so the same code path works against Docker
 *      Redis locally, Upstash's TCP endpoint on Vercel, and any other
 *      managed Redis. Sliding-window state is shared across replicas, so
 *      this is the configuration to use in prod for a real security
 *      boundary.
 *   2. Otherwise, the in-memory implementation is used. Each process gets
 *      its own counters — fine for unit tests and Cypress runs that don't
 *      stand up Redis, NOT a security boundary in prod.
 */

export type RateLimitDecision = {
  /** True if the request is within the bucket's limit. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** Seconds the caller should wait before retrying. Always >=0; 0 when allowed. */
  retryAfterSeconds: number;
  /** Unix-ms timestamp at which the current window resets. */
  resetAt: number;
};

export type RateLimitBucketConfig = {
  /** Max requests permitted per IP per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export interface RateLimiter {
  /**
   * Record a request from `key` against the named `bucket` and return the
   * resulting decision. Must be safe to call concurrently.
   */
  check(bucket: string, key: string): Promise<RateLimitDecision>;
}

const PRODUCTION_BUCKETS: Record<string, RateLimitBucketConfig> = {
  // 10 credential attempts per IP per minute. Tight: anything sustained at
  // this rate is almost certainly a script.
  'auth:signin:credentials': { limit: 10, windowMs: 60_000 },
  // 30 OAuth sign-in clicks per IP per minute. Generous because shared NAT
  // can drive lots of legitimate clicks; the next bucket catches abuse.
  'auth:signin:provider':    { limit: 30, windowMs: 60_000 },
  // 60 callback hits per IP per minute. Callbacks are exchange-driven so
  // genuine traffic is bounded; allow a comfortable burst.
  'auth:callback':           { limit: 60, windowMs: 60_000 },
};

// The Cypress UI suite intentionally logs in fresh for every `it()` (each
// test's `beforeEach` calls `Cypress.session.clearAllSavedSessions()` before
// `cy.login`, because it also runs `db:reset` — reusing a session tied to an
// already-deleted user would be wrong). That's ~150+ legitimate credential
// POSTs from one IP inside the suite's ~10-minute run, all sharing the same
// Redis-backed counter (docker-compose.test.yml wires REDIS_URL into
// NODE_ENV=test on purpose, to exercise the real Redis adapter rather than
// the in-memory one). The production ceiling would false-positive on that
// traffic shape, so `RATE_LIMIT_AUTH_CREDENTIALS_LIMIT` lets `.env.test`
// widen just that bucket without touching the production default.
//
// This MUST be a plain, uniquely-named env var rather than a
// `process.env.NODE_ENV === 'test'` check: Next.js's bundler statically
// inlines `process.env.NODE_ENV` at build time (both `next build` and the
// `next start` server it produces treat the app as a production build), so
// a NODE_ENV-gated branch here gets dead-code-eliminated to the production
// value even when the process is actually run with NODE_ENV=test. A
// distinctly-named var has no such special-casing and is read dynamically
// at runtime as expected.
const credentialsLimitOverride = Number(process.env.RATE_LIMIT_AUTH_CREDENTIALS_LIMIT);

export const DEFAULT_BUCKETS: Record<string, RateLimitBucketConfig> =
  Number.isFinite(credentialsLimitOverride) && credentialsLimitOverride > 0
    ? { ...PRODUCTION_BUCKETS, 'auth:signin:credentials': { limit: credentialsLimitOverride, windowMs: 60_000 } }
    : PRODUCTION_BUCKETS;

let _instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (_instance) return _instance;
  if (process.env.REDIS_URL) {
    // Dynamic require so `ioredis` only lands in the bundle when Redis is
    // actually configured — keeps the in-memory code path (unit tests,
    // Cypress without Redis) free of the driver.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRedisRateLimiter } = require('./redis') as typeof import('./redis');
    _instance = createRedisRateLimiter(DEFAULT_BUCKETS);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createInMemoryRateLimiter } = require('./in-memory') as typeof import('./in-memory');
    _instance = createInMemoryRateLimiter(DEFAULT_BUCKETS);
  }
  return _instance;
}

/** Test helper: reset the cached instance so a fresh implementation is picked. */
export function _resetForTests(): void {
  _instance = null;
}
