import { GridColDef } from '@mui/x-data-grid';

export function role_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
  ];
}
