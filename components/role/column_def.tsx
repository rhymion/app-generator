import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function user_accounts_columns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'email', headerName: t('email'), width: 150, editable: editable },
    { field: 'password', headerName: t('password'), width: 150, editable: editable },
    { field: 'api_key', headerName: t('apiKey'), width: 150, editable: editable },
    { field: 'avatar', headerName: t('avatar'), width: 150, editable: editable },
  ];
}

