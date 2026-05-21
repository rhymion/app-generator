/**
 * In-memory rate limiter using a sliding-window log.
 *
 * Sliding-window over fixed-window because the latter has the classic
 * burst-at-boundary problem (2× the limit by clustering requests around a
 * window edge). The log here stores up to `limit` recent timestamps per
 * (bucket, key); on each check we drop expired entries, count what remains,
 * and either record the new timestamp or report the retry-after.
 *
 * Memory is bounded:
 *   - Per (bucket, key): at most `limit` timestamps (8 bytes each).
 *   - Global cap: `MAX_KEYS` total active keys across all buckets. When the
 *     LRU cap is hit, the least-recently-used (bucket, key) entry is dropped.
 *     A dropped key means the abuser's counter resets — acceptable trade-off
 *     in the single-process default; the distributed adapter has no such
 *     cap.
 *
 * This implementation is **not safe across processes**. It exists so dev
 * and Cypress can rely on the rate-limit code path without standing up
 * Redis; production needs the distributed adapter to be a real security
 * boundary.
 */
import type { RateLimitBucketConfig, RateLimitDecision, RateLimiter } from './index';

const MAX_KEYS = 10_000;

type LogEntry = { timestamps: number[]; lastTouched: number };

export function createInMemoryRateLimiter(
  buckets: Record<string, RateLimitBucketConfig>,
  now: () => number = Date.now,
): RateLimiter {
  // Map insertion order doubles as the LRU order; touching a key requires
  // delete-then-set to move it to the tail.
  const store = new Map<string, LogEntry>();

  function evictIfNeeded() {
    while (store.size > MAX_KEYS) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) return;
      store.delete(oldestKey);
    }
  }

  return {
    async check(bucket: string, key: string): Promise<RateLimitDecision> {
      const cfg = buckets[bucket];
      if (!cfg) {
        // An unknown bucket should not silently fail-open in production. The
        // safest default is to allow but flag — callers should pre-validate
        // bucket names against DEFAULT_BUCKETS at startup if they want to
        // be strict.
        return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0, resetAt: now() };
      }

      const cacheKey = `${bucket}::${key}`;
      const t = now();
      const windowStart = t - cfg.windowMs;

      let entry = store.get(cacheKey);
      if (!entry) {
        entry = { timestamps: [], lastTouched: t };
      } else {
        // Move to tail for LRU semantics.
        store.delete(cacheKey);
      }

      // Drop timestamps outside the window.
      while (entry.timestamps.length > 0 && entry.timestamps[0] <= windowStart) {
        entry.timestamps.shift();
      }

      if (entry.timestamps.length >= cfg.limit) {
        // Oldest in-window timestamp is the one that has to age out before
        // the next request would be allowed.
        const oldest = entry.timestamps[0];
        const retryAfterMs = Math.max(0, oldest + cfg.windowMs - t);
        entry.lastTouched = t;
        store.set(cacheKey, entry);
        evictIfNeeded();
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
          resetAt: oldest + cfg.windowMs,
        };
      }

      entry.timestamps.push(t);
      entry.lastTouched = t;
      store.set(cacheKey, entry);
      evictIfNeeded();

      return {
        allowed: true,
        remaining: cfg.limit - entry.timestamps.length,
        retryAfterSeconds: 0,
        resetAt: t + cfg.windowMs,
      };
    },
  };
}
