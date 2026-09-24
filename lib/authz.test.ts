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
      name: 'organization',
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
      name: 'role',
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

/**
 * subtask_1168 (cmd_1168): getModelPermissions used to filter by `name: model`
 * in the query itself, so a caller asking about N models issued N queries. It
 * now fetches every relevant row for the user in one query and groups by
 * `row.name` in-process. These tests pin the equivalence claim: a single
 * batched result spanning multiple models must still resolve each model's
 * permissions exactly as if that model had been queried alone — no
 * cross-model leakage, no shape change to the query beyond dropping `name`.
 */
describe('batched multi-model query: per-model grouping is equivalent to a per-model query (subtask_1168)', () => {
  const multiModelRows = [
    { name: 'role', create: true, read: true, update: true, delete: true, import: true, role: { name: 'Administrator' } },
    { name: 'organization', create: false, read: false, update: false, delete: false, import: false, role: { name: 'DenyRole' } },
    { name: 'user', create: false, read: true, update: false, delete: false, import: false, role: null },
  ];

  it("grants only the requested model's permissions when the batch spans multiple models", async () => {
    findMany.mockResolvedValueOnce(multiModelRows);
    const { permissions } = await getModelPermissions('role', 'user-test-1');
    expect(permissions).toMatchObject({ create: true, read: true, update: true, delete: true });
  });

  it('does not leak another model\'s grant onto a model with no rows in the batch', async () => {
    findMany.mockResolvedValueOnce(multiModelRows);
    const { permissions } = await getModelPermissions('dashboard', 'user-test-1');
    expect(permissions).toMatchObject({ create: false, read: false, update: false, delete: false });
  });

  it('denies the requested model even when another model in the same batch is granted', async () => {
    findMany.mockResolvedValueOnce(multiModelRows);
    const result = await canAccess('organization', 'read', 'user-test-1');
    expect(result).toBe(false);
  });

  it('resolves a global (role_id: null) row correctly when mixed with other models in the batch', async () => {
    findMany.mockResolvedValueOnce(multiModelRows);
    const result = await canAccess('user', 'read', 'user-test-1');
    expect(result).toBe(true);
  });

  it('issues exactly one findMany call per getModelPermissions invocation, with no name filter in the query', async () => {
    findMany.mockClear();
    findMany.mockResolvedValueOnce(multiModelRows);
    await getModelPermissions('user', 'user-test-1');
    expect(findMany).toHaveBeenCalledTimes(1);
    const [args] = findMany.mock.calls[0];
    expect(args.where).not.toHaveProperty('name');
    expect(args.select).toMatchObject({ name: true });
  });
});
