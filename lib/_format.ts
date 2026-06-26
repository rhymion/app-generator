import dayjs from 'dayjs';

/**
 * Format a date / time / date-time value for display in list views,
 * autocomplete option labels, and read-only form fields.
 *
 *   date      → "YYYY-MM-DD"          (universal — same date regardless of viewer's TZ)
 *   time      → "HH:mm"               (local time)
 *   date-time → "YYYY-MM-DD HH:mm"    (local time)
 *
 * For `date`, we pull the YYYY-MM-DD portion of the ISO string before handing
 * it to dayjs so a date stored as e.g. `2025-01-15T00:00:00.000Z` does not
 * shift backward when displayed in a UTC- timezone viewer.
 *
 * Anything else is rendered with `String(value)` and an empty / nullish input
 * yields ''. Mirrors the behavior of DataGridClient's column valueGetter.
 */
export function formatLabelValue(
  value: unknown,
  format?: 'date' | 'time' | 'date-time',
  showSeconds?: boolean,
): string {
  if (value === null || value === undefined || value === '') return '';
  if (format === 'date') {
    return dayjs(new Date(value as string).toISOString().slice(0, 10)).format('YYYY-MM-DD');
  }
  if (format === 'time') {
    return dayjs(value as string).format('HH:mm');
  }
  if (format === 'date-time') {
    return dayjs(value as string).format(showSeconds ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
  }
  return String(value);
}
