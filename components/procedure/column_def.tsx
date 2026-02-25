import { GridColDef } from '@mui/x-data-grid';

export function children_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}

export function preceded_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}

export function followed_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: 'Parent', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: 'Assignee', width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}
