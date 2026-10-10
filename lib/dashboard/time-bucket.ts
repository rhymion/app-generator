// Time-bucket and time-zone logic for dashboard widgets. Pure: it has no dependency on the
// generated catalog or on Prisma, so it can be unit-tested without generated code.
import { ApiError } from '@/lib/api-auth';
import { TIMEZONE_VALUES, TIMEZONE_IANA_NAME, DEFAULT_TIMEZONE, type Timezone } from '@/lib/_timezone';

export type BucketGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

const pad2 = (n: number) => String(n).padStart(2, '0');

const zoneFormatters = new Map<Timezone, Intl.DateTimeFormat>();

// Calendar year/month/day of an instant in the zone. The zone is resolved only through
// TIMEZONE_IANA_NAME, so no IANA spelling lives anywhere else.
function civilDateInZone(date: Date, zone: Timezone): { y: number; m: number; d: number } {
  let fmt = zoneFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE_IANA_NAME[zone],
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    zoneFormatters.set(zone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: pick('year'), m: pick('month'), d: pick('day') };
}

// Returns ISO-based bucket key for app-side grouping (no DB date_trunc). Boundaries are the zone's
// calendar day / Monday-start week / month / quarter / year, so they follow DST changes.
export function truncateToBucket(date: Date, bucket: BucketGranularity, zone: Timezone = DEFAULT_TIMEZONE): string {
  const { y, m, d } = civilDateInZone(date, zone);
  switch (bucket) {
    case 'day':
      return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
    case 'week': {
      // Civil-date arithmetic on a UTC date, so DST never enters the calculation.
      const monday = new Date(Date.UTC(y, m - 1, d));
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return `${String(y).padStart(4, '0')}-${pad2(m)}`;
    case 'quarter':
      return `${String(y).padStart(4, '0')}-${pad2(Math.floor((m - 1) / 3) * 3 + 1)}`;
    case 'year':
      return String(y).padStart(4, '0');
  }
}

// Bucket key of a stored value; a missing value goes to the '(unspecified)' bucket.
export function bucketKeyOf(val: unknown, bucket: BucketGranularity, zone: Timezone): string {
  if (val instanceof Date) return truncateToBucket(val, bucket, zone);
  if (typeof val === 'string' && val) return truncateToBucket(new Date(val), bucket, zone);
  return '(unspecified)';
}

// Human-readable bucket label from the ISO key produced by truncateToBucket.
export function formatBucketKey(key: string, bucket: BucketGranularity): string {
  if (bucket === 'quarter') {
    // key is "YYYY-MM" where MM is the first month of the quarter
    const [year, mm] = key.split('-');
    const q = Math.floor((Number(mm) - 1) / 3) + 1;
    return `${year} Q${q}`;
  }
  return key;
}

// A missing time zone means UTC; an unknown value is a client error, never silently coerced.
export function resolveTimezone(raw: string | null | undefined): Timezone {
  if (raw == null || raw === '') return DEFAULT_TIMEZONE;
  if (!(TIMEZONE_VALUES as readonly string[]).includes(raw)) {
    throw new ApiError(400, `Unknown timezone: ${raw}`);
  }
  return raw as Timezone;
}

// Resolves the requested zone for a group-by field. Date-only fields keep the calendar date as
// stored (UTC); a time zone only applies to date-times, so any other zone is rejected.
export function resolveBucketZone(
  raw: string | null | undefined,
  field: { kind: string; datetime_format?: string },
  groupByField: string,
): Timezone {
  const zone = resolveTimezone(raw);
  const zoneApplies = field.kind === 'datetime' && field.datetime_format === 'date-time';
  if (zone !== DEFAULT_TIMEZONE && !zoneApplies) {
    throw new ApiError(400, `timezone '${zone}' requires a date-time group_by_field; '${groupByField}' is not a date-time field`);
  }
  return zone;
}
