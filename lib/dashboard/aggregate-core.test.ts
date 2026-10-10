import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({ default: { task: { findMany: (args: unknown) => findMany(args) } } }));
vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('./catalog', () => {
  const fields = [
    { name: 'created_at', label: 'Created At', kind: 'datetime', datetime_format: 'date-time' },
    { name: 'due_date', label: 'Due Date', kind: 'datetime', datetime_format: 'date' },
    { name: 'is_done', label: 'Is Done', kind: 'boolean' },
  ];
  const entity = { name: 'task', label: 'Task', groupable_fields: fields };
  return {
    findDashboardEntity: (name: string) => (name === 'task' ? entity : undefined),
    findDashboardField: (e: string, f: string) => (e === 'task' ? fields.find((x) => x.name === f) : undefined),
  };
});

import { aggregateForWidgetCore, truncateToBucket } from './aggregate-core';

describe('truncateToBucket', () => {
  it('defaults to UTC and keeps the former boundaries', () => {
    const d = new Date('2026-10-01T23:30:00Z');
    expect(truncateToBucket(d, 'day')).toBe('2026-10-01');
    expect(truncateToBucket(d, 'month')).toBe('2026-10');
    expect(truncateToBucket(d, 'quarter')).toBe('2026-10');
    expect(truncateToBucket(d, 'year')).toBe('2026');
    // 2026-10-01 is a Thursday: the Monday start of the week is 2026-09-28.
    expect(truncateToBucket(d, 'week')).toBe('2026-09-28');
  });

  it('moves the day across midnight in an eastern zone', () => {
    const d = new Date('2026-10-01T23:30:00Z');
    expect(truncateToBucket(d, 'day', 'asia_tokyo')).toBe('2026-10-02');
    expect(truncateToBucket(d, 'week', 'asia_tokyo')).toBe('2026-09-28');
  });

  it('moves the month, quarter and year boundaries with the zone', () => {
    // 2026-12-31T20:00Z is already 2027-01-01 05:00 in Tokyo.
    const d = new Date('2026-12-31T20:00:00Z');
    expect(truncateToBucket(d, 'month', 'asia_tokyo')).toBe('2027-01');
    expect(truncateToBucket(d, 'quarter', 'asia_tokyo')).toBe('2027-01');
    expect(truncateToBucket(d, 'year', 'asia_tokyo')).toBe('2027');
    expect(truncateToBucket(d, 'year', 'utc')).toBe('2026');
    // 2027-04-01T02:00Z is still 2027-03-31 evening in Los Angeles (UTC-7 in DST).
    const q = new Date('2027-04-01T02:00:00Z');
    expect(truncateToBucket(q, 'month', 'america_los_angeles')).toBe('2027-03');
    expect(truncateToBucket(q, 'quarter', 'america_los_angeles')).toBe('2027-01');
  });

  it('starts a week on Monday in the zone', () => {
    // Sunday 2026-10-04 20:00Z is already Monday 2026-10-05 in Tokyo.
    const d = new Date('2026-10-04T20:00:00Z');
    expect(truncateToBucket(d, 'week', 'utc')).toBe('2026-09-28');
    expect(truncateToBucket(d, 'week', 'asia_tokyo')).toBe('2026-10-05');
  });

  it('follows DST changes: US spring-forward and fall-back days stay single, correct buckets', () => {
    // America/New_York: 2026-03-08 spring forward (EST -> EDT), 2026-11-01 fall back (EDT -> EST).
    expect(truncateToBucket(new Date('2026-03-08T04:59:59Z'), 'day', 'america_new_york')).toBe('2026-03-07');
    expect(truncateToBucket(new Date('2026-03-08T05:00:00Z'), 'day', 'america_new_york')).toBe('2026-03-08');
    // After the jump the day ends at 04:00Z on the 9th (23 h long), not 05:00Z.
    expect(truncateToBucket(new Date('2026-03-09T03:59:59Z'), 'day', 'america_new_york')).toBe('2026-03-08');
    expect(truncateToBucket(new Date('2026-03-09T04:00:00Z'), 'day', 'america_new_york')).toBe('2026-03-09');
    // The fall-back day is 25 h long: 04:00Z (EDT) through 04:59Z the next day (EST).
    expect(truncateToBucket(new Date('2026-11-01T03:59:59Z'), 'day', 'america_new_york')).toBe('2026-10-31');
    expect(truncateToBucket(new Date('2026-11-01T04:00:00Z'), 'day', 'america_new_york')).toBe('2026-11-01');
    expect(truncateToBucket(new Date('2026-11-02T04:59:59Z'), 'day', 'america_new_york')).toBe('2026-11-01');
    expect(truncateToBucket(new Date('2026-11-02T05:00:00Z'), 'day', 'america_new_york')).toBe('2026-11-02');
  });
});

describe('aggregateForWidgetCore time zones', () => {
  beforeEach(() => findMany.mockReset());

  it('buckets a date-time field in the selected zone and reports the zone', async () => {
    findMany.mockResolvedValue([
      { created_at: new Date('2026-10-01T23:30:00Z') },
      { created_at: new Date('2026-10-02T01:00:00Z') },
    ]);
    const utc = await aggregateForWidgetCore('task', 'created_at', null, undefined, undefined, 'day');
    expect(utc).toEqual({ kind: 'single', data: [{ label: '2026-10-01', count: 1 }, { label: '2026-10-02', count: 1 }] });
    const tokyo = await aggregateForWidgetCore('task', 'created_at', null, undefined, undefined, 'day', 'asia_tokyo');
    expect(tokyo).toEqual({ kind: 'single', data: [{ label: '2026-10-02', count: 2 }], timezone: 'asia_tokyo' });
  });

  it('treats a missing or utc zone as UTC without reporting a zone', async () => {
    findMany.mockResolvedValue([{ created_at: new Date('2026-10-01T23:30:00Z') }]);
    for (const tz of [undefined, null, '', 'utc']) {
      const out = await aggregateForWidgetCore('task', 'created_at', null, undefined, undefined, 'day', tz);
      expect(out).toEqual({ kind: 'single', data: [{ label: '2026-10-01', count: 1 }] });
    }
  });

  it('keeps a date-only value on its stored calendar date (UTC), including for a zone west of UTC', async () => {
    // A @db.Date column reads back as UTC midnight of the stored calendar date.
    findMany.mockResolvedValue([{ due_date: new Date('2026-10-01T00:00:00Z') }]);
    const out = await aggregateForWidgetCore('task', 'due_date', null, undefined, undefined, 'month');
    expect(out).toEqual({ kind: 'single', data: [{ label: '2026-10', count: 1 }] });
    // Converting to Los Angeles would shift it to 2026-09-30; a non-utc zone on a date-only field is rejected instead.
    await expect(
      aggregateForWidgetCore('task', 'due_date', null, undefined, undefined, 'month', 'america_los_angeles'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an unknown zone and an IANA spelling with 400', async () => {
    for (const bad of ['Asia/Tokyo', 'mars_olympus', 'UTC']) {
      await expect(
        aggregateForWidgetCore('task', 'created_at', null, undefined, undefined, 'day', bad),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects a non-utc zone on a field that is not a date-time', async () => {
    await expect(
      aggregateForWidgetCore('task', 'is_done', null, undefined, undefined, undefined, 'asia_tokyo'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('applies the zone to multi-series buckets too', async () => {
    findMany.mockResolvedValue([
      { created_at: new Date('2026-10-01T23:30:00Z'), is_done: true },
      { created_at: new Date('2026-10-02T01:00:00Z'), is_done: false },
    ]);
    const out = await aggregateForWidgetCore('task', 'created_at', null, 'is_done', undefined, 'day', 'asia_tokyo');
    expect(out).toMatchObject({ kind: 'multi', categories: ['2026-10-02'], timezone: 'asia_tokyo' });
  });
});
