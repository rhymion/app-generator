/**
 * Cache a lazily-constructed value on a `globalThis`-like object, keyed by
 * name, so that repeated evaluations of the importing module within the
 * same process return the same instance. Extracted into its own
 * dependency-free module (mirroring `lib/prisma-pool.ts`) so the caching
 * behavior itself can be unit-tested without importing `lib/prisma.ts`,
 * which pulls in `@/app/generated/prisma/client` -- a file that only
 * exists after `generate-code` has run, and is therefore unavailable at
 * the `test:vitest` gate step (which runs before `generate-code` in the
 * Completion gate order).
 *
 * Must apply unconditionally, in every environment. A NODE_ENV-gated
 * version of this pattern (cache only outside production) assumes each
 * production request runs in a fresh process, which a platform that
 * evaluates the importing module's bundle more than once within one
 * long-lived process (e.g. a warm instance handling multiple concurrent
 * invocations, each with its own bundle-scoped copy of the module) breaks:
 * skipping the cache in production there silently constructs a new,
 * independent instance -- and, for `lib/prisma.ts`, a new independent
 * connection pool -- on every such evaluation, uncoordinated with the
 * others and with any per-process resource ceiling the caller assumed.
 */
export function cacheOnGlobal<T>(
  globalObj: Record<string, unknown>,
  key: string,
  create: () => T,
): T {
  const cached = globalObj[key] as T | undefined;
  if (cached) return cached;
  const created = create();
  globalObj[key] = created;
  return created;
}
