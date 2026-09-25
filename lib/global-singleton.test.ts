import { describe, it, expect, vi, afterEach } from 'vitest';
import { cacheOnGlobal } from './global-singleton';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cacheOnGlobal', () => {
  it('invokes create only once and returns the same reference on repeat calls', () => {
    const globalObj: Record<string, unknown> = {};
    const create = vi.fn(() => ({ id: 'instance' }));

    const first = cacheOnGlobal(globalObj, 'thing', create);
    const second = cacheOnGlobal(globalObj, 'thing', create);
    const third = cacheOnGlobal(globalObj, 'thing', create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('reproduces the empirically-measured 4-module-evaluation scenario (subtask_1174a) with a single instance', () => {
    // subtask_1174a measured lib/prisma.ts's module body being evaluated 4
    // times within one long-lived process (route handler, Server Action,
    // client-page render, instrumentation.ts cold-start hook each getting
    // their own bundle-scoped copy). Each evaluation calls this function
    // against the SAME `global`-backed object but is otherwise an
    // independent call site -- exactly what the 4 separate calls below
    // simulate.
    const globalObj: Record<string, unknown> = {};
    const create = vi.fn(() => ({ pool: Symbol('pool') }));

    const evaluations = [
      cacheOnGlobal(globalObj, 'prisma', create),
      cacheOnGlobal(globalObj, 'prisma', create),
      cacheOnGlobal(globalObj, 'prisma', create),
      cacheOnGlobal(globalObj, 'prisma', create),
    ];

    expect(create).toHaveBeenCalledTimes(1);
    expect(new Set(evaluations).size).toBe(1);
  });

  it('caches identically under NODE_ENV=production (the exact case the removed guard used to skip)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const globalObj: Record<string, unknown> = {};
    const create = vi.fn(() => ({ id: 'prod-instance' }));

    const first = cacheOnGlobal(globalObj, 'thing', create);
    const second = cacheOnGlobal(globalObj, 'thing', create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('keeps independent keys and independent global objects separate', () => {
    const globalObj: Record<string, unknown> = {};
    const createA = vi.fn(() => ({ id: 'a' }));
    const createB = vi.fn(() => ({ id: 'b' }));

    const a = cacheOnGlobal(globalObj, 'a', createA);
    const b = cacheOnGlobal(globalObj, 'b', createB);

    expect(a).not.toBe(b);
    expect(createA).toHaveBeenCalledTimes(1);
    expect(createB).toHaveBeenCalledTimes(1);

    const otherGlobalObj: Record<string, unknown> = {};
    const createC = vi.fn(() => ({ id: 'c' }));
    const c = cacheOnGlobal(otherGlobalObj, 'a', createC);

    expect(c).not.toBe(a);
    expect(createC).toHaveBeenCalledTimes(1);
  });
});
