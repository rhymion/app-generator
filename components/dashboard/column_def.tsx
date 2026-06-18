import type { GridColDef } from '@/components/ui/data';
import { useTranslations } from 'next-intl';

export function useWidgetsColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'entity_name', headerName: t('entityName'), width: 150, editable: editable },
    { field: 'chart_type', headerName: t('chartType'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: 0, label: 'pie' }, { value: 1, label: 'column' }, { value: 2, label: 'bar' }, { value: 3, label: 'line' }] },
    { field: 'stack_mode', headerName: t('stackMode'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: '' as const, label: '-- None --' }, { value: 0, label: 'grouped' }, { value: 1, label: 'stacked' }, { value: 2, label: 'standardized' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueGetter: (value: any) => value ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueSetter: (value: any, row: any) => ({ ...row, stack_mode: value === '' ? null : value }) },
    { field: 'series_field', headerName: t('seriesField'), width: 150, editable: editable },
    { field: 'group_by_bucket', headerName: t('groupByBucket'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: '' as const, label: '-- None --' }, { value: 0, label: 'day' }, { value: 1, label: 'week' }, { value: 2, label: 'month' }, { value: 3, label: 'quarter' }, { value: 4, label: 'year' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueGetter: (value: any) => value ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueSetter: (value: any, row: any) => ({ ...row, group_by_bucket: value === '' ? null : value }) },
    { field: 'group_by_field', headerName: t('groupByField'), width: 150, editable: editable },
    { field: 'filter_field', headerName: t('filterField'), width: 150, editable: editable },
    { field: 'filter_value', headerName: t('filterValue'), width: 150, editable: editable },
    { field: 'order', headerName: t('order'), width: 50, editable: false, type: 'number' },
  ];
}

