/**
 * The permission cache is process-local and live in production builds. A role,
 * permission or role-membership write clears it through
 * invalidatePermissionCache(); that call has to reach the copy of the cache
 * every other bundle of this module reads, or a revoked grant stays usable
 * until the 30 second TTL runs out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { permission: { findMany } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }));

const GRANT = [{ name: 'role', create: false, read: true, update: false, delete: false, import: false, role: null }];

async function loadAuthz() {
  vi.resetModules();
  return import('./authz');
}

describe('permission cache invalidation', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    findMany.mockReset();
    delete (globalThis as Record<string, unknown>).__permissionCache;
    delete (globalThis as Record<string, unknown>).__permissionRowsCache;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves a repeated lookup from the cache', async () => {
    const authz = await loadAuthz();
    findMany.mockResolvedValue(GRANT);
    await authz.getPermissionRowsForUser('u1');
    await authz.getPermissionRowsForUser('u1');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('reads the database again after invalidatePermissionCache()', async () => {
    const authz = await loadAuthz();
    findMany.mockResolvedValueOnce(GRANT);
    expect((await authz.getPermissionRowsForUser('u1')).length).toBe(1);
    findMany.mockResolvedValueOnce([]);
    await authz.invalidatePermissionCache();
    expect(await authz.getPermissionRowsForUser('u1')).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('clears the cache that another copy of the module reads', async () => {
    const reader = await loadAuthz();
    findMany.mockResolvedValueOnce(GRANT);
    await reader.getPermissionRowsForUser('u1');
    // A second bundle of the module, as the build makes for Server Actions.
    const writer = await loadAuthz();
    await writer.invalidatePermissionCache();
    findMany.mockResolvedValueOnce([]);
    expect(await reader.getPermissionRowsForUser('u1')).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
