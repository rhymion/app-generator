import { GridColDef } from '@mui/x-data-grid';

export function fields_columns(editable: boolean = false, referenceIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'type', headerName: 'Type', width: 150, editable: editable },
    ...(referenceIdOptions && referenceIdOptions.length > 0
      ? [{ field: 'reference_id', headerName: 'Reference', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: referenceIdOptions }]
      : [{ field: 'reference_id', headerName: 'Reference', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.reference?.name ?? '' }]),
    { field: 'max_length', headerName: 'Max Length', width: 100, editable: editable, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: editable, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: editable },
    { field: 'required', headerName: 'Required', width: 100, editable: editable, type: 'boolean' },
  ];
}

export function db_table_comments_columns(editable: boolean = false): GridColDef[] {
  return [
    { field: 'message', headerName: 'Message', width: 150, editable: editable },
  ];
}
