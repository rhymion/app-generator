import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  attachmentFindUnique: vi.fn(),
  attachmentDeleteMany: vi.fn(),
  mobileSessionUpdateMany: vi.fn(),
  notificationDeleteMany: vi.fn(),
  idempotencyDeleteMany: vi.fn(),
  accountDeleteMany: vi.fn(),
  accountCount: vi.fn(),
  sessionDeleteMany: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  deleteStoredObject: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const tx = {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    attachment: { findUnique: mocks.attachmentFindUnique, deleteMany: mocks.attachmentDeleteMany },
    mobile_session: { updateMany: mocks.mobileSessionUpdateMany },
    notification: { deleteMany: mocks.notificationDeleteMany },
    idempotency_key: { deleteMany: mocks.idempotencyDeleteMany },
    account: { deleteMany: mocks.accountDeleteMany, count: mocks.accountCount },
    session: { deleteMany: mocks.sessionDeleteMany },
    mfa_recovery_code: { deleteMany: mocks.recoveryDeleteMany },
  };
  return { default: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('@/lib/attachment/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachment/storage')>()),
  deleteStoredObject: mocks.deleteStoredObject,
}));

import { anonymizeUser } from './anonymize_user';

const STORED_KEY = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

describe('anonymizeUser related records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountCount.mockResolvedValue(0);
    mocks.deleteStoredObject.mockResolvedValue(undefined);
    mocks.userFindUnique.mockResolvedValue({ anonymized_at: null, invalidated_at: null, image_id: 'att1' });
    mocks.attachmentFindUnique.mockResolvedValue({ path: STORED_KEY });
  });

  it('scrubs device names, deletes the avatar row and its stored file', async () => {
    const res = await anonymizeUser('u1');
    expect(res.success).toBe(true);
    expect(mocks.mobileSessionUpdateMany).toHaveBeenCalledWith({ where: { user_id: 'u1' }, data: { device_name: null } });
    expect(mocks.notificationDeleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
    expect(mocks.idempotencyDeleteMany).toHaveBeenCalledWith({ where: { actor_user_id: 'u1' } });
    expect(mocks.attachmentDeleteMany).toHaveBeenCalledWith({ where: { id: 'att1' } });
    expect(mocks.deleteStoredObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteStoredObject).toHaveBeenCalledWith(STORED_KEY);
  });

  it('revokes the mobile sessions that are not yet revoked', async () => {
    const first = new Date('2026-01-02T03:04:05Z');
    mocks.userFindUnique.mockResolvedValue({ anonymized_at: first, invalidated_at: first, image_id: null });
    const res = await anonymizeUser('u1');
    expect(res.success).toBe(true);
    expect(mocks.mobileSessionUpdateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', revoked_at: null },
      data: { revoked_at: first },
    });
  });

  it('keeps the first erasure time on a repeated call', async () => {
    const first = new Date('2026-01-02T03:04:05Z');
    mocks.userFindUnique.mockResolvedValue({ anonymized_at: first, invalidated_at: first, image_id: null });
    const res = await anonymizeUser('u1');
    expect(res.anonymizedAt).toEqual(first);
    const data = mocks.userUpdate.mock.calls[0][0].data;
    expect(data.anonymized_at).toEqual(first);
    expect(data.invalidated_at).toEqual(first);
    expect(mocks.attachmentDeleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteStoredObject).not.toHaveBeenCalled();
  });

  it('reports a failed file removal without undoing the erasure', async () => {
    mocks.deleteStoredObject.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const res = await anonymizeUser('u1');
    expect(res.success).toBe(true);
    expect(res.errors?.[0]).toContain('Stored avatar file was not removed');
  });

  it('rolls back and reports when the user does not exist', async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    const res = await anonymizeUser('nope');
    expect(res.success).toBe(false);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
