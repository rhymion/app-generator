import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { truncateToBucket, bucketKeyOf, formatBucketKey, resolveTimezone, resolveBucketZone } from './time-bucket';

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

const DATE_TIME = { kind: 'datetime', datetime_format: 'date-time' };
const DATE_ONLY = { kind: 'datetime', datetime_format: 'date' };

describe('bucketKeyOf', () => {
  it('buckets a date-time in the selected zone and puts a missing value in (unspecified)', () => {
    const d = new Date('2026-10-01T23:30:00Z');
    expect(bucketKeyOf(d, 'day', 'utc')).toBe('2026-10-01');
    expect(bucketKeyOf(d, 'day', 'asia_tokyo')).toBe('2026-10-02');
    expect(bucketKeyOf('2026-10-01T23:30:00Z', 'day', 'asia_tokyo')).toBe('2026-10-02');
    expect(bucketKeyOf(null, 'day', 'utc')).toBe('(unspecified)');
  });

  it('keeps a date-only value (UTC midnight) on its stored calendar date in UTC', () => {
    // A @db.Date column reads back as UTC midnight of the stored calendar date.
    const d = new Date('2026-10-01T00:00:00Z');
    expect(bucketKeyOf(d, 'month', 'utc')).toBe('2026-10');
    // Converting to Los Angeles would shift it to 2026-09-30, which is why a zone is never applied to date-only fields.
    expect(bucketKeyOf(d, 'month', 'america_los_angeles')).toBe('2026-09');
  });
});

describe('formatBucketKey', () => {
  it('labels quarters and leaves other keys as they are', () => {
    expect(formatBucketKey('2026-10', 'quarter')).toBe('2026 Q4');
    expect(formatBucketKey('2026-10-01', 'day')).toBe('2026-10-01');
  });
});

describe('resolveTimezone', () => {
  it('treats a missing or utc zone as UTC', () => {
    for (const tz of [undefined, null, '', 'utc']) expect(resolveTimezone(tz)).toBe('utc');
  });

  it('accepts an enum member', () => {
    expect(resolveTimezone('asia_tokyo')).toBe('asia_tokyo');
  });

  it('rejects an unknown zone and an IANA spelling with 400', () => {
    for (const bad of ['Asia/Tokyo', 'mars_olympus', 'UTC']) {
      expect(() => resolveTimezone(bad)).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('resolveBucketZone', () => {
  it('applies the zone to a date-time field', () => {
    expect(resolveBucketZone('asia_tokyo', DATE_TIME, 'created_at')).toBe('asia_tokyo');
  });

  it('allows utc or no zone on any field', () => {
    expect(resolveBucketZone(undefined, DATE_ONLY, 'due_date')).toBe('utc');
    expect(resolveBucketZone('utc', { kind: 'boolean' }, 'is_done')).toBe('utc');
  });

  it('rejects a non-utc zone on a date-only field, so its bucket is never shifted', () => {
    expect(() => resolveBucketZone('america_los_angeles', DATE_ONLY, 'due_date')).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects a non-utc zone on a field that is not a date-time', () => {
    expect(() => resolveBucketZone('asia_tokyo', { kind: 'boolean' }, 'is_done')).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});
