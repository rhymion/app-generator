import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// vi.mock is hoisted to the top of the file before any other code runs, so
// shared mocks have to be declared via vi.hoisted to be available when the
// mock factory executes. notify() fire-and-forget writes through this mock
// on every call in this file — tests below that don't care about the DB
// write just let it resolve/reject in the background.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { notification: { create } },
}));

import {
  notify,
  listNotifications,
  unreadCount,
  markAllRead,
  clearInbox,
  _resetForTests,
} from './_notifier';

beforeEach(() => {
  _resetForTests();
  create.mockReset();
  create.mockResolvedValue({});
});

describe('notify + listNotifications', () => {
  it('returns an empty array for an unknown user', () => {
    expect(listNotifications('nobody')).toEqual([]);
  });

  it('stores notifications and returns them newest-first', () => {
    notify('u1', 'assigned', { title: 'first' });
    notify('u1', 'assigned', { title: 'second' });
    const items = listNotifications('u1');
    expect(items.map((n) => n.payload.title)).toEqual(['second', 'first']);
  });

  it('isolates per-user inboxes', () => {
    notify('u1', 'assigned', { title: 'for u1' });
    notify('u2', 'assigned', { title: 'for u2' });
    expect(listNotifications('u1').map((n) => n.payload.title)).toEqual(['for u1']);
    expect(listNotifications('u2').map((n) => n.payload.title)).toEqual(['for u2']);
  });

  it('caps each user at 50 entries (FIFO)', () => {
    for (let i = 0; i < 60; i++) notify('u1', 'assigned', { title: `n${i}` });
    const items = listNotifications('u1');
    expect(items).toHaveLength(50);
    // Oldest dropped → newest 50 remain. Newest-first ordering means the
    // most recent entry (n59) is first and n10 is last.
    expect(items[0].payload.title).toBe('n59');
    expect(items[items.length - 1].payload.title).toBe('n10');
  });
});

describe('unreadCount', () => {
  it('counts only entries that have not been marked read', () => {
    notify('u1', 'assigned', { title: 'a' });
    notify('u1', 'assigned', { title: 'b' });
    expect(unreadCount('u1')).toBe(2);
    markAllRead('u1');
    expect(unreadCount('u1')).toBe(0);
    notify('u1', 'assigned', { title: 'c' });
    expect(unreadCount('u1')).toBe(1);
  });
});

describe('markAllRead', () => {
  it('marks every entry read and reports the changed count', () => {
    notify('u1', 'assigned', { title: 'a' });
    notify('u1', 'assigned', { title: 'b' });
    expect(markAllRead('u1')).toBe(2);
    expect(markAllRead('u1')).toBe(0);
    expect(listNotifications('u1').every((n) => n.read)).toBe(true);
  });

  it('returns 0 for an unknown user (no-op)', () => {
    expect(markAllRead('nobody')).toBe(0);
  });
});

describe('clearInbox', () => {
  it('removes a user\'s entries entirely', () => {
    notify('u1', 'assigned', { title: 'a' });
    clearInbox('u1');
    expect(listNotifications('u1')).toEqual([]);
  });
});

describe('TTL eviction', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops entries older than 7 days on read', () => {
    notify('u1', 'assigned', { title: 'old' });
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    notify('u1', 'assigned', { title: 'fresh' });
    const titles = listNotifications('u1').map((n) => n.payload.title);
    expect(titles).toEqual(['fresh']);
  });
});

describe('notify DB persistence (fire-and-forget)', () => {
  it('writes a matching row to the notification table', async () => {
    const entry = notify('u1', 'assigned', { title: 'persisted' });
    // notify() itself is synchronous; the write happens on a microtask.
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      data: {
        id: entry.id,
        user_id: 'u1',
        type: 'assigned',
        payload: { title: 'persisted' },
        read: false,
        created_at: new Date(entry.createdAt),
      },
    });
  });

  it('does not throw or affect the in-memory store when the DB write fails (e.g. FK violation on a deleted user)', async () => {
    create.mockReset();
    create.mockRejectedValue(new Error('Foreign key constraint violated: notification_user_id_fkey'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => notify('nobody-real', 'assigned', { title: 'orphan' })).not.toThrow();
    expect(listNotifications('nobody-real').map((n) => n.payload.title)).toEqual(['orphan']);

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0][0]).toBe('[_notifier:write_failed]');

    warnSpy.mockRestore();
  });
});
