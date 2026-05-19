import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  notify,
  listNotifications,
  unreadCount,
  markAllRead,
  clearInbox,
  subscribe,
  _resetForTests,
  type Notification,
} from './_notifier';

beforeEach(() => {
  _resetForTests();
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

describe('subscribe', () => {
  it('fires the handler for matching userId only', () => {
    const heard: Notification[] = [];
    const off = subscribe('u1', (n) => heard.push(n));
    notify('u1', 'assigned', { title: 'mine' });
    notify('u2', 'assigned', { title: 'theirs' });
    expect(heard.map((n) => n.payload.title)).toEqual(['mine']);
    off();
  });

  it('stops firing after unsubscribe', () => {
    const heard: Notification[] = [];
    const off = subscribe('u1', (n) => heard.push(n));
    notify('u1', 'assigned', { title: 'first' });
    off();
    notify('u1', 'assigned', { title: 'second' });
    expect(heard).toHaveLength(1);
  });

  it('supports multiple concurrent subscribers for one user (e.g. two tabs)', () => {
    const heardA: Notification[] = [];
    const heardB: Notification[] = [];
    const offA = subscribe('u1', (n) => heardA.push(n));
    const offB = subscribe('u1', (n) => heardB.push(n));
    notify('u1', 'assigned', { title: 'broadcast' });
    expect(heardA).toHaveLength(1);
    expect(heardB).toHaveLength(1);
    offA();
    offB();
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
