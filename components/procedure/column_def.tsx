import { GridColDef } from '@mui/x-data-grid';

export function children_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent Id', width: 150, editable: editable },
  ];
}

export function preceded_by_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent Id', width: 150, editable: editable },
  ];
}

export function followed_by_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent Id', width: 150, editable: editable },
  ];
}
