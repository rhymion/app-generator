import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function yyyyy_yyyyys_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'type', headerName: t('type'), width: 150, editable: editable },
    { field: 'max_length', headerName: t('maxLength'), width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: t('max'), width: 100, editable: editable, type: 'number' },
    { field: 'regex', headerName: t('regex'), width: 150, editable: editable },
    { field: 'required', headerName: t('required'), width: 100, editable: editable, type: 'boolean' },
    { field: 'written_by', headerName: t('writtenBy'), width: 150, editable: editable },
  ];
}

