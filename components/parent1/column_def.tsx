import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import dayjs from 'dayjs';

export function parent1_child1s_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'order', headerName: t('order'), width: 50, editable: false, type: 'number' },
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'type', headerName: t('type'), width: 150, editable: editable },
    { field: 'max_length', headerName: t('maxLength'), width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: t('max'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: '' as const, label: '-- None --' }, { value: 100, label: '100' }, { value: 255, label: '255' }, { value: 65535, label: '65535' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueGetter: (value: any) => value ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueSetter: (value: any, row: any) => ({ ...row, max: value === '' ? null : value }) },
    { field: 'regex', headerName: t('regex'), width: 150, editable: editable },
    { field: 'required', headerName: t('required'), width: 100, editable: editable, type: 'boolean' },
    { field: 'written_by', headerName: t('writtenBy'), width: 150, editable: editable },
  ];
}

export function parent1_child2s_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'required', headerName: t('required'), width: 100, editable: editable, type: 'boolean' },
    {
      field: 'start_date',
      headerName: t('startDate'),
      width: 250,
      editable: editable,
      type: 'dateTime',
      renderEditCell: (params: GridRenderEditCellParams) => (
        <DateTimeWrapper
          label={t('startDate')}
          date_time={params.value ? new Date(params.value) : null}
          onChange={(newValue: dayjs.Dayjs | null) => {
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: newValue ? newValue.toISOString() : ''
            });
          }}
        />
      ),
      valueFormatter: (value) => {
        if (!value) return '';
        return dayjs(value).format('YYYY-MM-DD HH:mm');
      },
    },
    {
      field: 'end_date',
      headerName: t('endDate'),
      width: 250,
      editable: editable,
      type: 'dateTime',
      renderEditCell: (params: GridRenderEditCellParams) => (
        <DateTimeWrapper
          label={t('endDate')}
          date_time={params.value ? new Date(params.value) : null}
          onChange={(newValue: dayjs.Dayjs | null) => {
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: newValue ? newValue.toISOString() : ''
            });
          }}
        />
      ),
      valueFormatter: (value) => {
        if (!value) return '';
        return dayjs(value).format('YYYY-MM-DD HH:mm');
      },
    },
  ];
}

export function parent1_lists_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
  ];
}
