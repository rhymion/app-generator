/**
 * Tiny in-memory TTL + LRU cache. One instance per cache "namespace"
 * (e.g. api-keys, model permissions). Per-process — Vercel/Next.js function
 * instances each get their own copy. That's expected; the cache is
 * eventually consistent across instances within `ttlMs`.
 *
 * Notes
 *  - `get()` evicts and returns `undefined` for expired entries; it also
 *    refreshes recency so frequently-hit keys stay in the LRU window.
 *  - `set()` evicts the oldest entry when `maxSize` is reached.
 *  - `delete()` is the explicit invalidation hook (e.g. on api-key rotation).
 *  - Both valid and "negative" lookups are cacheable — the caller decides
 *    what to store. Keep negative TTL short and cap `maxSize` so unknown-key
 *    probing can't pin memory.
 */
export class TtlLruCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  constructor(private maxSize: number, private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value as K | undefined;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
