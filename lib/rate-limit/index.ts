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
 *   1. If `UPSTASH_REDIS_REST_URL` is set, Upstash is selected. The current
 *      adapter is a stub that throws — wire the real adapter in when ready.
 *   2. Otherwise, the in-memory implementation is used. Note: in a multi-
 *      instance deployment, each process gets its own counters — fine for
 *      dev/test/CI, NOT a security boundary in prod.
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

export const DEFAULT_BUCKETS: Record<string, RateLimitBucketConfig> = {
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

let _instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (_instance) return _instance;
  if (process.env.UPSTASH_REDIS_REST_URL) {
    // Dynamic require keeps the (currently throwing) Upstash adapter out of
    // the in-memory code path's import graph.
    const { createUpstashRateLimiter } = require('./upstash') as typeof import('./upstash');
    _instance = createUpstashRateLimiter(DEFAULT_BUCKETS);
  } else {
    const { createInMemoryRateLimiter } = require('./in-memory') as typeof import('./in-memory');
    _instance = createInMemoryRateLimiter(DEFAULT_BUCKETS);
  }
  return _instance;
}

/** Test helper: reset the cached instance so a fresh implementation is picked. */
export function _resetForTests(): void {
  _instance = null;
}
