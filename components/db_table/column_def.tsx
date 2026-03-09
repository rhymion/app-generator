import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function fields_columns(editable: boolean = false, referenceIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'type', headerName: t('type'), width: 150, editable: editable },
    ...(referenceIdOptions && referenceIdOptions.length > 0
      ? [{ field: 'reference_id', headerName: t('reference'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: referenceIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'reference_id', headerName: t('reference'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.reference?.name ?? '' }]),
    { field: 'max_length', headerName: t('maxLength'), width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: t('max'), width: 100, editable: editable, type: 'number' },
    { field: 'regex', headerName: t('regex'), width: 150, editable: editable },
    { field: 'required', headerName: t('required'), width: 100, editable: editable, type: 'boolean' },
  ];
}

