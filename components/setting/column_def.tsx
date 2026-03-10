import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function roles_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'description', headerName: t('description'), width: 150, editable: editable },
  ];
}

