import { describe, it, expect, beforeEach, vi } from 'vitest';

const { roleCount, auditCreate } = vi.hoisted(() => ({
  roleCount: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { role: { count: roleCount }, audit_log: { create: auditCreate } },
}));

import { trySelfOnlyAdminBypass } from './self_only';

beforeEach(() => {
  roleCount.mockReset();
  auditCreate.mockReset();
});

describe('trySelfOnlyAdminBypass', () => {
  it('denies bypass when the actor does not hold the privileged role', async () => {
    roleCount.mockResolvedValueOnce(0);

    const granted = await trySelfOnlyAdminBypass('personal_note', 'user-1');

    expect(granted).toBe(false);
    expect(roleCount).toHaveBeenCalledWith({
      where: { name: 'Administrator', users: { some: { id: 'user-1' } } },
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('grants bypass and writes an audit row when the actor is privileged and the write succeeds', async () => {
    roleCount.mockResolvedValueOnce(1);
    auditCreate.mockResolvedValueOnce({ id: 'audit-row-1' });

    const granted = await trySelfOnlyAdminBypass('personal_note', 'admin-1');

    expect(granted).toBe(true);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const [{ data }] = auditCreate.mock.calls[0];
    expect(data.action).toBe('self_only:admin_bypass');
    expect(data.actor_user_id).toBe('admin-1');
    expect(data.target_table).toBe('personal_note');
  });

  it('fail-closed: denies bypass when the actor is privileged but the audit write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    roleCount.mockResolvedValueOnce(1);
    auditCreate.mockRejectedValueOnce(new Error('db unavailable'));

    const granted = await trySelfOnlyAdminBypass('personal_note', 'admin-1');

    expect(granted).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, payloadJson] = warn.mock.calls[0];
    expect(tag).toBe('[self_only:admin_bypass_denied]');
    const payload = JSON.parse(payloadJson as string);
    expect(payload.entity).toBe('personal_note');
    expect(payload.actor_user_id).toBe('admin-1');
    expect(payload.error).toBe('db unavailable');
    warn.mockRestore();
  });
});
