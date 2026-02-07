import { GridColDef } from '@mui/x-data-grid';

export function user_accounts_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'email', headerName: 'Email', width: 150, editable: editable },
    { field: 'password', headerName: 'Password', width: 150, editable: editable },
    { field: 'api_key', headerName: 'Api Key', width: 150, editable: editable },
    { field: 'avatar', headerName: 'Avatar', width: 150, editable: editable },
  ];
}
