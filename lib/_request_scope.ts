import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped memoization, replacing React `cache()` as the mechanism
 * that dedupes repeated calls (e.g. permission lookups) within one request.
 *
 * `cache()` only dedupes inside a React render tree (Server Component
 * render or Server Action) — a Next.js Route Handler (`app/api/.../
 * route.ts`) is not part of a React render, so a function wrapped in
 * `cache()` and called multiple times with identical arguments inside one
 * Route Handler invocation runs its body in full every time. This module
 * provides the same one-call-per-request guarantee for BOTH paths, since
 * it relies only on Node's own async execution graph, not React internals.
 *
 * `enterRequestScope()` is called once, at the top of each of the two
 * shared entry points every generated Route Handler / Server Action /
 * Server Component already calls first — `authenticateApiKey()` (API-key
 * auth) and `getSessionUserId()` (session-cookie auth, also the first call
 * most session-based code makes) — so no other call site needs to know
 * this module exists. `AsyncLocalStorage.enterWith()` scopes the store to
 * the current causal chain only (the awaits that follow, not concurrent,
 * unrelated requests being interleaved on the same process), which is what
 * makes a single Map safe to share across an entire request without
 * leaking into any other request.
 */
const requestScopeStorage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Idempotent: a second call within the same causal chain is a no-op, so
 * calling this from more than one entry point (e.g. a Route Handler that
 * happens to call both authenticateApiKey() and getSessionUserId()) never
 * resets an already-active store mid-request. */
export function enterRequestScope(): void {
  if (!requestScopeStorage.getStore()) {
    requestScopeStorage.enterWith(new Map());
  }
}

/**
 * Returns the memoized promise for `key` if the current request already has
 * one, else calls `compute()`, stores its promise immediately (before it
 * resolves), and returns it — so a concurrent caller (e.g. two `canAccess()`
 * calls run inside `Promise.all`) that reaches this before `compute()`
 * settles reuses the same in-flight promise instead of starting a second
 * one, matching `cache()`'s own concurrent-dedup semantics.
 *
 * Falls through to a plain, unmemoized `compute()` when no request scope is
 * active (e.g. a caller reached before either entry point ran, a unit test
 * that doesn't go through the app's normal Next.js request path, or a
 * build-time call) — this is the same "no dedup" behavior every such call
 * already had before this module existed, so there is no regression, only
 * an added fast path when a scope IS active.
 */
export function memoizeInRequestScope<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const store = requestScopeStorage.getStore();
  if (!store) return compute();
  const existing = store.get(key);
  if (existing) return existing as Promise<T>;
  const promise = compute();
  store.set(key, promise);
  return promise;
}
