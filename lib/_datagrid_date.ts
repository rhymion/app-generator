import dayjs, { type Dayjs } from 'dayjs';

/**
 * Value conversions between MUI X pickers (Dayjs) and the values the DataGrid
 * date / dateTime columns carry. The grid's native date inputs defined these
 * shapes (see GridFilterInputDate / GridEditDateCell in @mui/x-data-grid);
 * the picker-based filter and edit cells reproduce them exactly, so stored
 * values, filter values sent to the server and time zones do not change.
 *
 *  - filter value: `new Date('YYYY-MM-DD')` (UTC midnight) for a date column,
 *    `new Date('YYYY-MM-DDTHH:mm')` (local time) for a dateTime column.
 *  - edit value: a `Date` at local midnight (date) or local HH:mm, seconds
 *    zeroed (dateTime).
 */
export type DateColumnKind = 'date' | 'dateTime';

const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

function isUsable(value: Dayjs | null | undefined): value is Dayjs {
  return !!value && value.isValid() && value.year() >= MIN_YEAR && value.year() <= MAX_YEAR;
}

/** Filter item value (a Date, ISO string or empty) to the picker's value. */
export function filterValueToPickerValue(value: unknown, kind: DateColumnKind): Dayjs | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return null;
  // A date column's filter Date is UTC midnight of the chosen calendar day.
  if (kind === 'date') return dayjs(date.toISOString().substring(0, 10));
  return dayjs(date);
}

/**
 * Picker value to the filter item value. `null` clears the filter
 * (`undefined`); an incomplete or invalid entry returns `null` so callers can
 * ignore it instead of applying a half-typed date.
 */
export function pickerValueToFilterValue(value: Dayjs | null, kind: DateColumnKind): Date | undefined | null {
  if (value === null) return undefined;
  if (!isUsable(value)) return null;
  return kind === 'date'
    ? new Date(value.format('YYYY-MM-DD'))
    : new Date(value.format('YYYY-MM-DDTHH:mm'));
}

/** Edit-cell value (Date, ISO string or empty) to the picker's value. */
export function editValueToPickerValue(value: unknown): Dayjs | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return dayjs(date);
}

/**
 * Picker value to the edit-cell value. `null` clears the cell; `undefined`
 * means the entry is incomplete or invalid and must not be written.
 */
export function pickerValueToEditValue(value: Dayjs | null, kind: DateColumnKind): Date | null | undefined {
  if (value === null) return null;
  if (!isUsable(value)) return undefined;
  return kind === 'date'
    ? value.startOf('day').toDate()
    : value.second(0).millisecond(0).toDate();
}
