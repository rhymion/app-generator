/**
 * Reachability of a referenced row is decided on the model's own entity.
 *
 * A user who holds permission only on a proxy view of a model (a different
 * entity name over the same table) cannot reference that model's rows: the
 * decision reads the model's own permission rows, organization and
 * x-self-only, and nothing declared on a view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { permission: { findMany }, role: { count: vi.fn(async () => 0) } },
}));
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u-me' } })),
}));
vi.mock('@/lib/self_only', () => ({ trySelfOnlyAdminBypass: vi.fn(async () => false) }));

import { invalidatePermissionCache } from './authz';
import { isRowReachable } from './_reachability';

const row = (name: string) => ({
  name, create: false, read: true, update: false, delete: false, import: false, role: null,
});
const orgs = new Set(['org-1']);
const item = { organization_id: 'org-1', creator_id: 'u-other', assignee_id: null };

beforeEach(async () => {
  findMany.mockReset();
  await invalidatePermissionCache();
});

describe('isRowReachable', () => {
  it('is reachable with read permission on the model itself', async () => {
    findMany.mockResolvedValue([row('item')]);
    expect(await isRowReachable('u-me', orgs, { model: 'item' }, item)).toBe(true);
  });

  it('is not reachable with read permission only on a proxy view of the model', async () => {
    findMany.mockResolvedValue([row('item_view')]);
    expect(await isRowReachable('u-me', orgs, { model: 'item' }, item)).toBe(false);
  });

  it('is not reachable in another organization even with read permission on the model', async () => {
    findMany.mockResolvedValue([row('item')]);
    expect(await isRowReachable('u-me', orgs, { model: 'item' }, { ...item, organization_id: 'org-2' })).toBe(false);
  });
});
