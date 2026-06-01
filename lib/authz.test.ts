/**
 * Category 2: No-permission behavior tests
 *
 * Verifies default-deny semantics: users with no permission records are denied
 * all CRUD operations, and users with explicit DenyRole records are also denied.
 */
import { describe, it, expect, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { permission: { findMany } },
}));

// Mock auth session so getSessionUserId returns a deterministic value.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-test-1' } })),
}));

import { getModelPermissions, requirePermission, canAccess } from './authz';

describe('default-deny: user with no permission records', () => {
  it('getModelPermissions returns all-false flags when rows=[]', async () => {
    findMany.mockResolvedValueOnce([]);
    const { permissions } = await getModelPermissions('role', 'user-test-1');
    expect(permissions.create).toBe(false);
    expect(permissions.read).toBe(false);
    expect(permissions.update).toBe(false);
    expect(permissions.delete).toBe(false);
  });

  it('canAccess returns false for create when no permissions', async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await canAccess('role', 'create', 'user-test-1');
    expect(result).toBe(false);
  });

  it('canAccess returns false for read when no permissions', async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await canAccess('user', 'read', 'user-test-1');
    expect(result).toBe(false);
  });

  it('canAccess returns false for update when no permissions', async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await canAccess('permission', 'update', 'user-test-1');
    expect(result).toBe(false);
  });

  it('requirePermission throws Access denied for read when no permissions', async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(requirePermission('role', 'read', undefined, 'user-test-1'))
      .rejects.toThrow('Access denied: role.read');
  });

  it('requirePermission throws Access denied for create when no permissions', async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(requirePermission('dashboard', 'create', undefined, 'user-test-1'))
      .rejects.toThrow('Access denied: dashboard.create');
  });
});

describe('explicit deny: user with DenyRole (all flags=false)', () => {
  const denyRows = [
    {
      create: false,
      read: false,
      update: false,
      delete: false,
      role: { name: 'DenyRole' },
    },
  ];

  it('canAccess returns false for all operations under DenyRole', async () => {
    for (const op of ['create', 'read', 'update', 'delete'] as const) {
      findMany.mockResolvedValueOnce(denyRows);
      const result = await canAccess('organization', op, 'user-test-1');
      expect(result).toBe(false);
    }
  });

  it('requirePermission throws when user has explicit DenyRole for delete', async () => {
    findMany.mockResolvedValueOnce(denyRows);
    await expect(requirePermission('organization', 'delete', undefined, 'user-test-1'))
      .rejects.toThrow('Access denied: organization.delete');
  });
});

describe('grant: user with explicit full permissions is allowed', () => {
  const grantRows = [
    {
      create: true,
      read: true,
      update: true,
      delete: true,
      role: { name: 'Administrator' },
    },
  ];

  it('canAccess returns true for read when Administrator role grants it', async () => {
    findMany.mockResolvedValueOnce(grantRows);
    const result = await canAccess('role', 'read', 'user-test-1');
    expect(result).toBe(true);
  });

  it('requirePermission succeeds when user has explicit full grant', async () => {
    findMany.mockResolvedValueOnce(grantRows);
    await expect(requirePermission('role', 'create', undefined, 'user-test-1'))
      .resolves.toBeDefined();
  });
});
