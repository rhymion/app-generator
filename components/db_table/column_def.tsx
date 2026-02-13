import { GridColDef } from '@mui/x-data-grid';

export function fields_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'type', headerName: 'Type', width: 150, editable: editable },
    { field: 'max_length', headerName: 'Max Length', width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: editable, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: editable },
    { field: 'required', headerName: 'Required', width: 100, editable: editable, type: 'boolean' },
  ];
}
