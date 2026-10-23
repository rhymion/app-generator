import { vi } from 'vitest';

/**
 * Module factory for `vi.mock('@/lib/rate-limit', ...)`: keeps the real
 * `DEFAULT_BUCKETS` and the real in-memory limiter, but builds the instance
 * with a static import because `getRateLimiter()` selects it through a
 * CommonJS `require`, which Vitest's ESM loader cannot resolve. Lets a test
 * exercise the production ceilings without a mock that could drift from them.
 */
export async function realRateLimiterModule() {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  const { createInMemoryRateLimiter } = await vi.importActual<typeof import('@/lib/rate-limit/in-memory')>(
    '@/lib/rate-limit/in-memory',
  );
  let instance: ReturnType<typeof createInMemoryRateLimiter> | null = null;
  return {
    ...actual,
    getRateLimiter: () => (instance ??= createInMemoryRateLimiter(actual.DEFAULT_BUCKETS)),
    _resetForTests: () => {
      instance = null;
    },
  };
}
