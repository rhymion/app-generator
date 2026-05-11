import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TtlLruCache } from './_ttl_lru';

describe('TtlLruCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for missing keys', () => {
    const c = new TtlLruCache<string, number>(10, 1000);
    expect(c.get('missing')).toBeUndefined();
  });

  it('returns set values within TTL', () => {
    const c = new TtlLruCache<string, number>(10, 1000);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
  });

  it('expires entries after TTL', () => {
    const c = new TtlLruCache<string, number>(10, 1000);
    c.set('a', 1);
    vi.advanceTimersByTime(1001);
    expect(c.get('a')).toBeUndefined();
  });

  it('refreshes recency on get so frequent keys survive eviction', () => {
    const c = new TtlLruCache<string, number>(2, 1000);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // 'a' becomes most-recent
    c.set('c', 3); // should evict 'b' (oldest), not 'a'
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('evicts oldest entry when at maxSize', () => {
    const c = new TtlLruCache<string, number>(2, 1000);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it('overwrites existing values without growing size', () => {
    const c = new TtlLruCache<string, number>(2, 1000);
    c.set('a', 1);
    c.set('a', 2);
    expect(c.get('a')).toBe(2);
    expect(c.size).toBe(1);
  });

  it('supports caching negative results (e.g. null for invalid api keys)', () => {
    const c = new TtlLruCache<string, string | null>(10, 1000);
    c.set('bad-key', null);
    // The cache MUST distinguish "miss" from "stored null"
    expect(c.get('bad-key')).toBeNull();
    expect(c.get('other-key')).toBeUndefined();
  });

  it('delete() removes a single entry', () => {
    const c = new TtlLruCache<string, number>(10, 1000);
    c.set('a', 1);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
  });

  it('clear() empties the cache', () => {
    const c = new TtlLruCache<string, number>(10, 1000);
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });
});
