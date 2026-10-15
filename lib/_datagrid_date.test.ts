import dayjs from 'dayjs';
import { describe, it, expect } from 'vitest';
import {
  editValueToPickerValue,
  filterValueToPickerValue,
  pickerValueToEditValue,
  pickerValueToFilterValue,
} from './_datagrid_date';

// The native inputs these pickers replace define the value shapes. The
// expectations below are the native results spelled out, so a change here
// would change what is filtered and saved.
describe('filter value conversion', () => {
  it('date: picker day -> UTC-midnight Date, same as new Date(<native input value>)', () => {
    const v = pickerValueToFilterValue(dayjs('2026-10-15'), 'date') as Date;
    expect(v).toBeInstanceOf(Date);
    expect(v.toISOString()).toBe(new Date('2026-10-15').toISOString());
    expect(v.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });

  it('dateTime: picker moment -> local-time Date, same as new Date(<datetime-local value>)', () => {
    const v = pickerValueToFilterValue(dayjs('2026-10-15T09:30:45'), 'dateTime') as Date;
    expect(v.getTime()).toBe(new Date('2026-10-15T09:30').getTime());
  });

  it('clearing yields undefined; an incomplete or invalid entry is ignored (null)', () => {
    expect(pickerValueToFilterValue(null, 'date')).toBeUndefined();
    expect(pickerValueToFilterValue(dayjs('not a date'), 'date')).toBeNull();
    expect(pickerValueToFilterValue(dayjs('2026-01-01').year(2), 'dateTime')).toBeNull();
  });

  it('round-trips a date filter value through the picker without shifting the day', () => {
    const picker = filterValueToPickerValue(new Date('2026-10-15'), 'date')!;
    expect(picker.format('YYYY-MM-DD')).toBe('2026-10-15');
    expect(pickerValueToFilterValue(picker, 'date')).toEqual(new Date('2026-10-15'));
  });

  it('round-trips a dateTime filter value', () => {
    const original = new Date('2026-10-15T09:30');
    const picker = filterValueToPickerValue(original, 'dateTime')!;
    expect(pickerValueToFilterValue(picker, 'dateTime')).toEqual(original);
  });

  it('treats empty and unparsable filter values as no value', () => {
    expect(filterValueToPickerValue(undefined, 'date')).toBeNull();
    expect(filterValueToPickerValue('', 'dateTime')).toBeNull();
    expect(filterValueToPickerValue('garbage', 'date')).toBeNull();
  });
});

describe('edit value conversion', () => {
  it('date: saves a Date at local midnight', () => {
    const v = pickerValueToEditValue(dayjs('2026-10-15T13:45'), 'date') as Date;
    expect(v.getTime()).toBe(new Date(2026, 9, 15, 0, 0, 0, 0).getTime());
  });

  it('dateTime: saves a local Date with seconds zeroed', () => {
    const v = pickerValueToEditValue(dayjs('2026-10-15T09:30:45.123'), 'dateTime') as Date;
    expect(v.getTime()).toBe(new Date(2026, 9, 15, 9, 30, 0, 0).getTime());
  });

  it('null clears the cell; an invalid entry is not written (undefined)', () => {
    expect(pickerValueToEditValue(null, 'date')).toBeNull();
    expect(pickerValueToEditValue(dayjs('nope'), 'dateTime')).toBeUndefined();
  });

  it('reads Date and ISO string cell values, and empty as null', () => {
    const d = new Date(2026, 9, 15, 9, 30);
    expect(editValueToPickerValue(d)!.valueOf()).toBe(d.getTime());
    expect(editValueToPickerValue(d.toISOString())!.valueOf()).toBe(d.getTime());
    expect(editValueToPickerValue(null)).toBeNull();
    expect(editValueToPickerValue('')).toBeNull();
    expect(editValueToPickerValue('garbage')).toBeNull();
  });
});
