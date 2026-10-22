/**
 * Date, date-time and time value rules shared by every layer that accepts one:
 * the Web form validation, the server-side write guard (service_validation.ts)
 * and the mobile date / date-time / time inputs. One definition, so the screens
 * and the API agree on what a valid value is and what shape it takes.
 *
 * Framework-free and Prisma-free: the mobile app receives a verbatim copy.
 *
 * Value shapes (the same on Web and mobile):
 *   date       YYYY-MM-DD
 *   date-time  ISO 8601 UTC instant, e.g. 2026-10-09T12:30:00Z
 *   time       HH:mm:ss
 */
export type DateValueFormat = 'date' | 'date-time' | 'time';

export const DATE_VALUE_HINTS: Record<DateValueFormat, string> = {
  date: 'YYYY-MM-DD',
  'date-time': 'YYYY-MM-DDTHH:mm:ssZ',
  time: 'HH:mm:ss',
};

const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/;

function validCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function validClock(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59;
}

function validOffset(offset: string | undefined): boolean {
  if (!offset || offset === 'Z') return true;
  const digits = offset.slice(1).replace(':', '');
  return Number(digits.slice(0, 2)) <= 23 && Number(digits.slice(2)) <= 59;
}

function isValidText(format: DateValueFormat, text: string): boolean {
  if (format === 'time') {
    const time = TIME_PATTERN.exec(text);
    if (time) return validClock(Number(time[1]), Number(time[2]), Number(time[3] ?? 0));
  }
  const match = DATE_TIME_PATTERN.exec(text);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offset] = match;
  if (!validCalendarDate(Number(year), Number(month), Number(day))) return false;
  if (hour !== undefined && !validClock(Number(hour), Number(minute), Number(second ?? 0))) return false;
  return validOffset(offset);
}

/**
 * Whether a submitted value is acceptable for a date / date-time / time field.
 * A missing value (null, undefined, blank text) is valid here: whether a value
 * is required is a separate check. A Date or a Dayjs-like object is valid when
 * it holds a real instant; any other non-string value is not this check's concern.
 */
export function isValidDateValue(format: DateValueFormat, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '' || isValidText(format, value.trim());
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'object' && 'isValid' in value) {
    const maybeDayjs = value as { isValid?: () => boolean };
    if (typeof maybeDayjs.isValid === 'function') return maybeDayjs.isValid();
  }
  return true;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Normalizes typed text to the shared value shape, or returns null when the text
 * is not a valid value. A date-time typed without an offset is read as local time.
 */
export function normalizeDateValue(format: DateValueFormat, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '' || !isValidText(format, trimmed)) return null;
  if (format === 'time') {
    const time = TIME_PATTERN.exec(trimmed);
    if (time) return `${time[1]}:${time[2]}:${time[3] ?? '00'}`;
    const parsed = new Date(trimmed);
    return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
  }
  const match = DATE_TIME_PATTERN.exec(trimmed)!;
  if (format === 'date') return `${match[1]}-${match[2]}-${match[3]}`;
  const instant = new Date(trimmed.replace(' ', 'T'));
  if (Number.isNaN(instant.getTime())) return null;
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The current moment in the shared value shape, for a "now" shortcut. */
export function currentDateValue(format: DateValueFormat, now: Date = new Date()): string {
  if (format === 'date') return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (format === 'time') return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A `time` column is a full DateTime on the wire (the Web TimePicker sends an instant); only its time of day
 * matters. The inputs show and edit the local time of day as HH:mm:ss; these two convert at the request boundary.
 */
export function timeOfDayToInstant(text: string, today: Date = new Date()): string | null {
  const normalized = normalizeDateValue('time', text);
  if (normalized === null) return null;
  const [hour, minute, second] = normalized.split(':').map(Number);
  const local = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, second);
  return local.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The local time of day (HH:mm:ss) of a stored instant; text that is already a time of day is returned as is. */
export function instantToTimeOfDay(value: string): string {
  if (TIME_PATTERN.test(value)) return normalizeDateValue('time', value) ?? value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  return `${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}`;
}
