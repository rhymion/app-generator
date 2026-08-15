import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted to the top of the file before any other code runs, so
// shared mocks have to be declared via vi.hoisted to be available when the
// mock factory executes. notify() fire-and-forget writes through this mock
// on every call in this file.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { notification: { create } },
}));

import { notify } from './_notifier';

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({});
});

describe('notify', () => {
  it('writes a matching row to the notification table', async () => {
    notify('u1', 'assigned', { title: 'persisted' });
    // notify() itself is synchronous; the write happens on a microtask.
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        user_id: 'u1',
        type: 'assigned',
        payload: { title: 'persisted' },
        read: false,
        created_at: expect.any(Date),
      },
    });
  });

  it('does not throw when the DB write fails (e.g. FK violation on a deleted user)', async () => {
    create.mockRejectedValue(new Error('Foreign key constraint violated: notification_user_id_fkey'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => notify('nobody-real', 'assigned', { title: 'orphan' })).not.toThrow();

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0][0]).toBe('[_notifier:write_failed]');

    warnSpy.mockRestore();
  });
});
