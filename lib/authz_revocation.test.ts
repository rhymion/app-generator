/**
 * A permission revoke must be visible to the very next check, with no cache
 * window. Production builds bake NODE_ENV=production in, so this test stubs it
 * the same way to exercise the code path a deployed server runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { permission: { findMany } },
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-revoke-1' } })),
}));

const row = (del: boolean) => ({
  name: 'approval_flow',
  create: false,
  read: true,
  update: false,
  delete: del,
  import: false,
  role: { name: 'Editor' },
});

describe('permission revoke takes effect immediately in a production build', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    findMany.mockReset();
  });

  it('getModelPermissions reflects a revoke on the very next call', async () => {
    const { getModelPermissions } = await import('./authz');

    findMany.mockResolvedValueOnce([row(true)]);
    const before = await getModelPermissions('approval_flow', 'user-revoke-1');
    expect(before.permissions.delete).toBe(true);

    // Revoke in the database, then check again with no wait and no invalidation call.
    findMany.mockResolvedValueOnce([row(false)]);
    const after = await getModelPermissions('approval_flow', 'user-revoke-1');
    expect(after.permissions.delete).toBe(false);
  });

  it('requirePermission refuses a delete right after the revoke', async () => {
    const { requirePermission } = await import('./authz');

    findMany.mockResolvedValueOnce([row(true)]);
    await expect(requirePermission('approval_flow', 'delete', undefined, 'user-revoke-1')).resolves.toBeDefined();

    findMany.mockResolvedValueOnce([row(false)]);
    await expect(requirePermission('approval_flow', 'delete', undefined, 'user-revoke-1'))
      .rejects.toThrow('Access denied: approval_flow.delete');
  });
});
