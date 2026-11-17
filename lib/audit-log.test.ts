import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted to the top of the file before any other code runs, so
// shared mocks have to be declared via vi.hoisted to be available when the
// mock factory executes.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { audit_log: { create } },
}));

import { recordAuditEvent } from './audit-log';
import { __setHeadersSourceForTest } from './request-id';

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: 'cuid-test' });
  // Outside a request by default: headers() throws, as it does in a script.
  __setHeadersSourceForTest(async () => {
    throw new Error('headers() was called outside a request scope');
  });
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
        request_id: null,
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

  // Issue #1306: rows written while handling a request carry its server-generated id.
  it('stores the same request id on every row of one request, and a new one for the next request', async () => {
    let current: object = new Headers();
    __setHeadersSourceForTest(async () => current);

    await recordAuditEvent({ action: 'role:create' });
    await recordAuditEvent({ action: 'role:update' });
    current = new Headers();
    await recordAuditEvent({ action: 'role:delete' });

    const ids = create.mock.calls.map(([{ data }]) => data.request_id as string);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('ignores a client-supplied X-Request-Id', async () => {
    const headers = new Headers({ 'x-request-id': 'chosen-by-client' });
    __setHeadersSourceForTest(async () => headers);

    await recordAuditEvent({ action: 'auth:signIn' });

    const [{ data }] = create.mock.calls[0];
    expect(data.request_id).not.toBe('chosen-by-client');
    expect(typeof data.request_id).toBe('string');
  });

  it('stores null outside a request', async () => {
    await recordAuditEvent({ action: 'auth:signOut' });
    const [{ data }] = create.mock.calls[0];
    expect(data.request_id).toBeNull();
  });
});
