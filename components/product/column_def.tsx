import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function images_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'path', headerName: t('path'), width: 150, editable: editable },
  ];
}

