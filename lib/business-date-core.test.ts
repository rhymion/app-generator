import { describe, it, expect } from 'vitest';
import {
  businessContextOf,
  parseBusinessDateString,
  startOfDayInZone,
  startOfNextDayInZone,
  todayInZone,
  validateBusinessDateFields,
  type AppSettingBusinessFields,
} from './business-date-core';

const row = (over: Partial<AppSettingBusinessFields> = {}): AppSettingBusinessFields => ({
  business_date: null,
  is_pinned: false,
  timezone: 'utc',
  ...over,
});
const iso = (d: Date) => d.toISOString();

describe('parseBusinessDateString', () => {
  it('reads a real date as UTC midnight', () => {
    expect(iso(parseBusinessDateString('2026-10-14')!)).toBe('2026-10-14T00:00:00.000Z');
  });
  it.each([null, undefined, '', '2026-1-4', '2026-02-30', '2026-13-01', 'not a date'])('rejects %j', (v) => {
    expect(parseBusinessDateString(v as string | null | undefined)).toBeNull();
  });
});

describe('todayInZone', () => {
  // 2026-10-14T17:30:00Z is already 2026-10-15 02:30 in Tokyo (UTC+9).
  const now = new Date('2026-10-14T17:30:00Z');
  it('is the UTC date in UTC', () => expect(iso(todayInZone(now, 'utc'))).toBe('2026-10-14T00:00:00.000Z'));
  it('is the next date in Asia/Tokyo', () => expect(iso(todayInZone(now, 'asia_tokyo'))).toBe('2026-10-15T00:00:00.000Z'));
  it('is the previous date west of UTC', () => {
    // 2026-10-15T02:00:00Z is 2026-10-14 22:00 in New York (UTC-4 in October).
    expect(iso(todayInZone(new Date('2026-10-15T02:00:00Z'), 'america_new_york'))).toBe('2026-10-14T00:00:00.000Z');
  });
  it('handles a half-hour offset (Asia/Kolkata, UTC+5:30)', () => {
    expect(iso(todayInZone(new Date('2026-10-14T18:45:00Z'), 'asia_kolkata'))).toBe('2026-10-15T00:00:00.000Z');
    expect(iso(todayInZone(new Date('2026-10-14T18:15:00Z'), 'asia_kolkata'))).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('startOfDayInZone / startOfNextDayInZone', () => {
  const d = new Date('2026-10-15T00:00:00Z');
  it('is the date itself in UTC', () => expect(iso(startOfDayInZone(d, 'utc'))).toBe('2026-10-15T00:00:00.000Z'));
  it('is nine hours earlier in Tokyo', () => expect(iso(startOfDayInZone(d, 'asia_tokyo'))).toBe('2026-10-14T15:00:00.000Z'));
  it('follows daylight saving in New York', () => {
    expect(iso(startOfDayInZone(d, 'america_new_york'))).toBe('2026-10-15T04:00:00.000Z'); // EDT, UTC-4
    expect(iso(startOfDayInZone(new Date('2026-12-15T00:00:00Z'), 'america_new_york'))).toBe('2026-12-15T05:00:00.000Z'); // EST
  });
  it('a 25-hour day ends at the next local midnight (fall back, 2026-11-01 in New York)', () => {
    const day = new Date('2026-11-01T00:00:00Z');
    expect(iso(startOfNextDayInZone(day, 'america_new_york'))).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('businessContextOf', () => {
  const now = new Date('2026-10-14T17:30:00Z');
  it('uses the stored date when pinned', () => {
    const ctx = businessContextOf(row({ is_pinned: true, business_date: '2026-10-01', timezone: 'asia_tokyo' }), now);
    expect(iso(ctx.businessDate)).toBe('2026-10-01T00:00:00.000Z');
    expect(ctx.timeZone).toBe('asia_tokyo');
  });
  it('uses today in the zone when not pinned, ignoring any stored date', () => {
    const ctx = businessContextOf(row({ business_date: '2026-10-01', timezone: 'asia_tokyo' }), now);
    expect(iso(ctx.businessDate)).toBe('2026-10-15T00:00:00.000Z');
  });
  it('falls back to today in the zone when a pinned row has no usable date', () => {
    expect(iso(businessContextOf(row({ is_pinned: true, timezone: 'asia_tokyo' }), now).businessDate)).toBe(
      '2026-10-15T00:00:00.000Z',
    );
  });
  it('falls back to today in UTC with no row at all', () => {
    const ctx = businessContextOf(null, now);
    expect(iso(ctx.businessDate)).toBe('2026-10-14T00:00:00.000Z');
    expect(ctx.timeZone).toBe('utc');
  });
});

describe('validateBusinessDateFields', () => {
  it('requires a date when pinned', () => {
    expect(() => validateBusinessDateFields(true, null)).toThrow(/required/);
    expect(() => validateBusinessDateFields(true, '')).toThrow(/required/);
    expect(() => validateBusinessDateFields(true, '2026-02-30')).toThrow(/YYYY-MM-DD/);
    expect(() => validateBusinessDateFields(true, '2026-10-14')).not.toThrow();
  });
  it('requires it empty when not pinned', () => {
    expect(() => validateBusinessDateFields(false, '2026-10-14')).toThrow(/empty/);
    expect(() => validateBusinessDateFields(false, null)).not.toThrow();
    expect(() => validateBusinessDateFields(false, undefined)).not.toThrow();
    expect(() => validateBusinessDateFields(false, '')).not.toThrow();
  });
});
