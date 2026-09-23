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
 *   - `api:read` / `api:write`  — per-API-key REST call ceilings (see below)
 *
 * The key inside each bucket is whatever uniquely identifies the abuser —
 * for the three buckets above, the caller's IP. `auth:mfa:challenge`
 * (Issue #588) is the first per-account bucket: it's keyed by the
 * authenticated user's id rather than IP, because the second-factor
 * Server Action (`app/[locale]/mfa-challenge/actions.ts`) is only reachable
 * after a valid first-factor session exists — an attacker brute-forcing a
 * stolen session's TOTP/recovery code can rotate IPs, but not the session's
 * user id. Future enhancements (per-email brute-force tracking on the
 * unauthenticated surfaces) can layer additional buckets without changing
 * the interface.
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
  // 10 second-factor attempts per user per 5 minutes (Issue #588). Keyed by
  // user id, not IP — see the module doc above. A genuine user fat-fingering
  // a 6-digit code a few times in a row is well under this; a script
  // spraying candidates against the 10^6 TOTP space or the recovery-code
  // list is not.
  'auth:mfa:challenge':      { limit: 10, windowMs: 5 * 60_000 },
  // Per-API-key REST ceilings (ai-agent-integration-design.md "Idempotency
  // keys and rate limiting — resolved design"). Keyed by the caller's
  // resolved user id, not IP: an API caller (agent or otherwise) can share
  // or rotate its IP, but its account is its real identity — the same
  // reasoning as `auth:mfa:challenge` above. 300/min read is set above a
  // realistic multi-page paging walk at `MAX_PAGE_SIZE` (lib/_pagination.ts);
  // 60/min write mirrors the existing `auth:callback` ceiling as a
  // reasonable starting point with no closer existing precedent. Both are
  // starting values (ruling), overridable below the same way
  // `auth:signin:credentials` already is.
  'api:read':                { limit: 300, windowMs: 60_000 },
  'api:write':               { limit: 60, windowMs: 60_000 },
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
// Same override mechanism and rationale as RATE_LIMIT_AUTH_CREDENTIALS_LIMIT
// above, extended to the two new API-key buckets: a real need for
// environment-specific overrides (design ruling's own proposed names), not
// speculative flexibility. A wrong initial pick is a config change, not a
// code change.
const apiReadLimitOverride = Number(process.env.RATE_LIMIT_API_READ_LIMIT);
const apiWriteLimitOverride = Number(process.env.RATE_LIMIT_API_WRITE_LIMIT);

export const DEFAULT_BUCKETS: Record<string, RateLimitBucketConfig> = {
  ...PRODUCTION_BUCKETS,
  ...(Number.isFinite(credentialsLimitOverride) && credentialsLimitOverride > 0
    ? { 'auth:signin:credentials': { limit: credentialsLimitOverride, windowMs: 60_000 } }
    : {}),
  ...(Number.isFinite(apiReadLimitOverride) && apiReadLimitOverride > 0
    ? { 'api:read': { limit: apiReadLimitOverride, windowMs: 60_000 } }
    : {}),
  ...(Number.isFinite(apiWriteLimitOverride) && apiWriteLimitOverride > 0
    ? { 'api:write': { limit: apiWriteLimitOverride, windowMs: 60_000 } }
    : {}),
};

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
