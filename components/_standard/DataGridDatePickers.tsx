'use client';
import { useMemo } from 'react';
import type { Dayjs } from 'dayjs';
import {
  getGridDateOperators,
  useGridApiContext,
  type GridColDef,
  type GridFilterInputValueProps,
  type GridRenderEditCellParams,
} from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import {
  editValueToPickerValue,
  filterValueToPickerValue,
  pickerValueToEditValue,
  pickerValueToFilterValue,
  type DateColumnKind,
} from '@/lib/_datagrid_date';

// The app-wide LocalizationProvider (app/[locale]/providers.tsx) supplies the
// dayjs adapter and the locale, the same as the form pickers, so the calendar
// text follows the app locale rather than the browser's UI language.

/** Filter value input for a date / dateTime column (replaces the native input). */
export function DataGridDateFilterInput(props: GridFilterInputValueProps & { kind: DateColumnKind }) {
  const { item, applyValue, focusElementRef, kind } = props;
  const value = useMemo(() => filterValueToPickerValue(item.value, kind), [item.value, kind]);

  const handleChange = (next: Dayjs | null) => {
    const filterValue = pickerValueToFilterValue(next, kind);
    if (filterValue === null) return;
    applyValue({ ...item, value: filterValue });
  };

  const Picker = kind === 'date' ? DatePicker : DateTimePicker;
  return (
    <Picker
      value={value}
      onChange={handleChange}
      inputRef={focusElementRef}
      slotProps={{ field: { clearable: true }, textField: { variant: 'standard', fullWidth: true } }}
    />
  );
}

/** Edit cell for a date / dateTime column (replaces the native input). */
export function DataGridDateEditCell(props: GridRenderEditCellParams & { kind: DateColumnKind }) {
  const { id, field, value, hasFocus, kind } = props;
  const apiRef = useGridApiContext();
  const pickerValue = useMemo(() => editValueToPickerValue(value), [value]);

  const handleChange = (next: Dayjs | null) => {
    const editValue = pickerValueToEditValue(next, kind);
    if (editValue === undefined) return;
    void apiRef.current.setEditCellValue({ id, field, value: editValue });
  };

  const Picker = kind === 'date' ? DatePicker : DateTimePicker;
  return (
    <Picker
      value={pickerValue}
      onChange={handleChange}
      autoFocus={hasFocus}
      slotProps={{ field: { clearable: true }, textField: { variant: 'standard', fullWidth: true } }}
      sx={{ width: '100%' }}
    />
  );
}

// Built once per kind at module scope: the column defs are rebuilt on every
// render, and a fresh component type per render would remount the picker and
// drop focus while the user types.
function DateFilterInput(props: GridFilterInputValueProps) {
  return <DataGridDateFilterInput {...props} kind="date" />;
}
function DateTimeFilterInput(props: GridFilterInputValueProps) {
  return <DataGridDateFilterInput {...props} kind="dateTime" />;
}
const renderDateEditCell = (params: GridRenderEditCellParams) => <DataGridDateEditCell {...params} kind="date" />;
const renderDateTimeEditCell = (params: GridRenderEditCellParams) => <DataGridDateEditCell {...params} kind="dateTime" />;

function buildFilterOperators(kind: DateColumnKind) {
  const Input = kind === 'date' ? DateFilterInput : DateTimeFilterInput;
  return getGridDateOperators(kind === 'dateTime').map((operator) =>
    operator.InputComponent ? { ...operator, InputComponent: Input } : operator,
  );
}

const COLUMN_PROPS: Record<DateColumnKind, Pick<GridColDef, 'filterOperators' | 'renderEditCell'>> = {
  date: { filterOperators: buildFilterOperators('date'), renderEditCell: renderDateEditCell },
  dateTime: { filterOperators: buildFilterOperators('dateTime'), renderEditCell: renderDateTimeEditCell },
};

/**
 * Column props that make a `type: 'date' | 'dateTime'` column filter and edit
 * through MUI pickers. Spread into the GridColDef after `type`.
 */
export function dateColumnProps(kind: DateColumnKind): Pick<GridColDef, 'filterOperators' | 'renderEditCell'> {
  return COLUMN_PROPS[kind];
}
