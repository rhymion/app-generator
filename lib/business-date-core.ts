// The business date: the one calendar date that screens and scheduled tasks treat as "today".
//
// It comes from the `app_setting` row that applies (docs/knowledge/appendix/business-date-container.md):
//   - `is_pinned: true`  -> the stored `business_date` ("YYYY-MM-DD"), whatever the clock says.
//   - `is_pinned: false` -> today's date in the row's `timezone`; `business_date` is not used.
//   - no row at all      -> today's date in UTC.
//
// A business date is a calendar date, carried as a `Date` at UTC midnight of that date (the same shape
// `scheduled_task_run.business_date` stores). The pure functions below have no database access so they are
// unit-testable (this file, free of Prisma); `getBusinessContext()` in business-date.ts is the single
// server-side read every caller uses.
import { AppError } from '@/lib/_errors';
import { DEFAULT_TIMEZONE, TIMEZONE_IANA_NAME, type Timezone } from '@/lib/_timezone';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BusinessContext {
  /** The business date, as UTC midnight of that calendar date. */
  businessDate: Date;
  /** The zone "today" is read in, and in which cron intervals are evaluated. */
  timeZone: Timezone;
}

export interface AppSettingBusinessFields {
  business_date: string | null;
  is_pinned: boolean;
  timezone: Timezone;
}

/** Parses "YYYY-MM-DD" into UTC midnight of that date; null if it is not a real calendar date. */
export function parseBusinessDateString(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || !BUSINESS_DATE_PATTERN.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : parsed;
}

/** Today's calendar date in `zone`, as UTC midnight of that date. */
export function todayInZone(now: Date, zone: Timezone): Date {
  const wall = now.getTime() + zoneOffsetMs(now.getTime(), zone);
  return new Date(Math.floor(wall / DAY_MS) * DAY_MS);
}

const wallClockFormatters = new Map<Timezone, Intl.DateTimeFormat>();

// Offset of `zone` from UTC at an instant, in milliseconds (positive east of UTC).
function zoneOffsetMs(instant: number, zone: Timezone): number {
  let fmt = wallClockFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE_IANA_NAME[zone],
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallClockFormatters.set(zone, fmt);
  }
  const parts = fmt.formatToParts(new Date(instant));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the calendar date `date` (UTC midnight of that date) begins in `zone`. For UTC it is
 * `date` itself. Two passes resolve the offset on a day where the zone changes it (daylight saving).
 */
export function startOfDayInZone(date: Date, zone: Timezone): Date {
  const wall = date.getTime();
  const first = wall - zoneOffsetMs(wall, zone);
  return new Date(wall - zoneOffsetMs(first, zone));
}

/** The instant at which the day after calendar date `date` begins in `zone` (the end of `date`, exclusive). */
export function startOfNextDayInZone(date: Date, zone: Timezone): Date {
  return startOfDayInZone(new Date(date.getTime() + DAY_MS), zone);
}

/** Applies the pinned / not-pinned rule to a row; no row means UTC today. */
export function businessContextOf(row: AppSettingBusinessFields | null, now: Date = new Date()): BusinessContext {
  if (!row) return { businessDate: todayInZone(now, DEFAULT_TIMEZONE), timeZone: DEFAULT_TIMEZONE };
  const timeZone = row.timezone;
  const pinned = row.is_pinned ? parseBusinessDateString(row.business_date) : null;
  // A pinned row without a usable date cannot be saved (see validateBusinessDateFields); if one exists anyway,
  // today in the row's zone is the least surprising date.
  return { businessDate: pinned ?? todayInZone(now, timeZone), timeZone };
}

/**
 * Save-time rule for `app_setting`: `business_date` is required (a real date) when `is_pinned` is true. When it is
 * false the value is not checked and never read (today in the row's timezone wins). Throws a field-level validation
 * error.
 */
export function validateBusinessDateFields(isPinned: boolean, businessDate: unknown): void {
  if (!isPinned) return;
  const empty = businessDate === null || businessDate === undefined || businessDate === '';
  if (empty) throw new AppError('VALIDATION', 'business_date is required when is_pinned is true', 'business_date', 'missing');
  if (typeof businessDate !== 'string' || parseBusinessDateString(businessDate) === null) {
    throw new AppError('VALIDATION', 'business_date must be a date in YYYY-MM-DD form', 'business_date', 'invalid');
  }
}

