import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirst, findMany, count } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    audit_log: { findFirst, findMany, count },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock('@/lib/authz', () => ({
  assertPermission: vi.fn(),
  getModelPermissions: vi.fn(),
  resolvePermissions: vi.fn(),
  toPermissions: vi.fn(),
}));

import { getAuditLogDetail, getAuditLogPage } from '@/lib/audit_log/getters';
import type { RichPermissions } from '@/lib/authz';

const ACTOR_SELECT = { id: true, name: true };
const perms = { general: { read: true } } as unknown as RichPermissions;

describe('audit_log actor relation', () => {
  beforeEach(() => {
    findFirst.mockReset();
    findMany.mockReset();
    count.mockReset();
  });

  it('getAuditLogDetail selects only id and name on the actor relation', async () => {
    findFirst.mockResolvedValueOnce({ id: 'a1', actor_user: { id: 'u1', name: 'Admin' }, metadata: null });
    const row = await getAuditLogDetail('a1');
    expect(findFirst.mock.calls[0][0].include.actor_user).toEqual({ select: ACTOR_SELECT });
    expect(Object.keys(row?.actor_user ?? {}).sort()).toEqual(['id', 'name']);
  });

  it('getAuditLogPage selects only id and name on the actor relation', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'a1', target_table: null, target_id: null, action: 'x', actor_user_id: 'u1', metadata: null, created_at: new Date(), actor_user: { id: 'u1', name: 'Admin' } },
    ]);
    count.mockResolvedValueOnce(1);
    const page = await getAuditLogPage({ page: 0, pageSize: 10 }, perms, 'u1');
    expect(findMany.mock.calls[0][0].include.actor_user).toEqual({ select: ACTOR_SELECT });
    expect(Object.keys(page.rows[0].actor_user ?? {}).sort()).toEqual(['id', 'name']);
  });
});
