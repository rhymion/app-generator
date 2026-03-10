import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function resource_attachments_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'order', headerName: t('order'), width: 50, editable: false, type: 'number' },
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'path', headerName: t('path'), width: 150, editable: editable },
  ];
}

export function resource_images_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'path', headerName: t('path'), width: 150, editable: editable },
  ];
}

