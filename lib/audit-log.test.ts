import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted to the top of the file before any other code runs, so
// shared mocks have to be declared via vi.hoisted to be available when the
// mock factory executes.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { audit_log: { create } },
}));

import { recordAuditEvent } from './audit-log';

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: 'cuid-test' });
});

describe('recordAuditEvent', () => {
  it('writes the row with full payload', async () => {
    await recordAuditEvent({
      action: 'role:create',
      actor_user_id: 'user-1',
      target_table: 'role',
      target_id: 'role-99',
      metadata: { name: 'Admin' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        action: 'role:create',
        actor_user_id: 'user-1',
        target_table: 'role',
        target_id: 'role-99',
        metadata: { name: 'Admin' },
      },
    });
  });

  it('coerces missing optional fields to null', async () => {
    await recordAuditEvent({ action: 'auth:signOut' });

    const [{ data }] = create.mock.calls[0];
    expect(data.actor_user_id).toBeNull();
    expect(data.target_table).toBeNull();
    expect(data.target_id).toBeNull();
    expect(data.metadata).toBeNull();
  });

  it('swallows DB errors when called outside a transaction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('boom'));

    await expect(
      recordAuditEvent({ action: 'auth:signIn', actor_user_id: 'u' }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, payloadJson] = warn.mock.calls[0];
    expect(tag).toBe('[audit_log:write_failed]');
    const payload = JSON.parse(payloadJson as string);
    expect(payload.action).toBe('auth:signIn');
    expect(payload.error).toBe('boom');
    warn.mockRestore();
  });

  it('rethrows DB errors when called inside a transaction so the tx rolls back', async () => {
    const txCreate = vi.fn().mockRejectedValue(new Error('tx-boom'));
    const tx = { audit_log: { create: txCreate } } as unknown as Parameters<typeof recordAuditEvent>[0]['tx'];

    await expect(
      recordAuditEvent({ action: 'role:update', actor_user_id: 'u', tx }),
    ).rejects.toThrow('tx-boom');

    // The transactional path must NOT touch the top-level prisma client.
    expect(create).not.toHaveBeenCalled();
  });

  it('routes the insert through the provided transaction client', async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: 'tx-row' });
    const tx = { audit_log: { create: txCreate } } as unknown as Parameters<typeof recordAuditEvent>[0]['tx'];

    await recordAuditEvent({
      action: 'permission:delete',
      actor_user_id: 'u',
      target_table: 'permission',
      target_id: 'p1',
      tx,
    });

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
