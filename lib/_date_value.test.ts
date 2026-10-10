import { describe, expect, it } from 'vitest';
import { currentDateValue, instantToTimeOfDay, timeOfDayToInstant, isValidDateValue, normalizeDateValue } from './_date_value';

describe('isValidDateValue', () => {
  it('accepts real dates, date-times and times', () => {
    expect(isValidDateValue('date', '2026-10-09')).toBe(true);
    expect(isValidDateValue('date-time', '2026-10-09T12:30:00Z')).toBe(true);
    expect(isValidDateValue('date-time', '2026-10-09T12:30:00.123+09:00')).toBe(true);
    expect(isValidDateValue('time', '23:59:59')).toBe(true);
    expect(isValidDateValue('time', '08:30')).toBe(true);
  });

  it('rejects text that is not a date or time', () => {
    expect(isValidDateValue('date-time', 'test')).toBe(false);
    expect(isValidDateValue('date', '2026-13-01')).toBe(false);
    expect(isValidDateValue('date', '2026-02-30')).toBe(false);
    expect(isValidDateValue('date-time', '2026-10-09T25:00:00Z')).toBe(false);
    expect(isValidDateValue('time', '24:00:00')).toBe(false);
    expect(isValidDateValue('time', 'noon')).toBe(false);
  });

  it('treats a missing value as valid (required is a separate check)', () => {
    expect(isValidDateValue('date', null)).toBe(true);
    expect(isValidDateValue('date', undefined)).toBe(true);
    expect(isValidDateValue('date-time', '  ')).toBe(true);
  });

  it('checks Date and Dayjs-like instances', () => {
    expect(isValidDateValue('date-time', new Date('2026-10-09T00:00:00Z'))).toBe(true);
    expect(isValidDateValue('date-time', new Date('nope'))).toBe(false);
    expect(isValidDateValue('date', { isValid: () => false })).toBe(false);
    expect(isValidDateValue('date', { isValid: () => true })).toBe(true);
  });
});

describe('normalizeDateValue', () => {
  it('returns the shared shape', () => {
    expect(normalizeDateValue('date', '2026-10-09T12:30:00Z')).toBe('2026-10-09');
    expect(normalizeDateValue('date-time', '2026-10-09T12:30:00.000Z')).toBe('2026-10-09T12:30:00Z');
    expect(normalizeDateValue('date-time', '2026-10-09T12:30:00+09:00')).toBe('2026-10-09T03:30:00Z');
    expect(normalizeDateValue('time', '08:30')).toBe('08:30:00');
  });

  it('returns null for invalid or blank text', () => {
    expect(normalizeDateValue('date-time', 'test')).toBeNull();
    expect(normalizeDateValue('date', '')).toBeNull();
  });
});

describe('currentDateValue', () => {
  it('formats the given moment in the shared shape', () => {
    const now = new Date('2026-10-09T12:30:45.678Z');
    expect(currentDateValue('date-time', now)).toBe('2026-10-09T12:30:45Z');
    expect(isValidDateValue('date', currentDateValue('date', now))).toBe(true);
    expect(isValidDateValue('time', currentDateValue('time', now))).toBe(true);
  });
});

describe('time of day on the wire', () => {
  it('round-trips the local time of day through an instant', () => {
    const instant = timeOfDayToInstant('08:30', new Date(2026, 9, 9));
    expect(instant).not.toBeNull();
    expect(isValidDateValue('time', instant)).toBe(true);
    expect(instantToTimeOfDay(instant!)).toBe('08:30:00');
  });

  it('rejects an invalid time and leaves unparseable stored text alone', () => {
    expect(timeOfDayToInstant('noon')).toBeNull();
    expect(instantToTimeOfDay('08:30')).toBe('08:30:00');
    expect(instantToTimeOfDay('junk')).toBe('junk');
  });
});
