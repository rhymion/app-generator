/**
 * Upstash Redis adapter — stub.
 *
 * This file marks the seam for swapping the in-memory limiter out for a
 * distributed one. The real implementation has not been wired up yet so that
 * the first PR for S1 stays small and dependency-free.
 *
 * Plug-in contract for the next PR:
 *
 *   - Add `@upstash/ratelimit` and `@upstash/redis` to package.json.
 *   - Replace the body of `createUpstashRateLimiter` with a real adapter
 *     that constructs a `Redis` client from `UPSTASH_REDIS_REST_URL` +
 *     `UPSTASH_REDIS_REST_TOKEN`, then maps each bucket to an
 *     `@upstash/ratelimit` `Ratelimit` instance keyed by the bucket name.
 *   - `check(bucket, key)` shells out to that bucket's `.limit(key)` and
 *     converts the result to `RateLimitDecision` (note: Upstash returns
 *     `reset` as an absolute timestamp in ms; this module's contract is
 *     also ms, so no conversion needed).
 *   - Add a Vitest that mocks the Upstash modules and asserts the bucket
 *     wiring + decision mapping.
 *
 * Until then, calling `getRateLimiter()` while `UPSTASH_REDIS_REST_URL` is
 * set throws at construction time so misconfigurations fail loudly rather
 * than silently degrading to in-memory limits.
 */
import type { RateLimitBucketConfig, RateLimiter } from './index';

export function createUpstashRateLimiter(
  _buckets: Record<string, RateLimitBucketConfig>,
): RateLimiter {
  throw new Error(
    'Upstash rate-limit adapter is not wired up yet. Either unset ' +
      'UPSTASH_REDIS_REST_URL to fall back to in-memory, or implement the ' +
      'adapter (see lib/rate-limit/upstash.ts for the plug-in contract).',
  );
}
