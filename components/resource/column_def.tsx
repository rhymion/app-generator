import { GridColDef } from '@mui/x-data-grid';

export function resource_attachments_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'order', headerName: 'No.', width: 50, editable: false, type: 'number' },
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'path', headerName: 'Path', width: 150, editable: editable },
  ];
}

export function resource_images_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'path', headerName: 'Path', width: 150, editable: editable },
  ];
}
