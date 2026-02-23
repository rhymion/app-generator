import { GridColDef } from '@mui/x-data-grid';

export function children_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect', valueOptions: parentIdOptions ?? [] },
    { field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect', valueOptions: assigneeIdOptions ?? [] },
  ];
}

export function preceded_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect', valueOptions: parentIdOptions ?? [] },
    { field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect', valueOptions: assigneeIdOptions ?? [] },
  ];
}

export function followed_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  return [
    { field: 'name', headerName: 'Name', width: 150, editable: editable },
    { field: 'description', headerName: 'Description', width: 150, editable: editable },
    { field: 'parent_id', headerName: 'Parent', width: 200, editable: editable, type: 'singleSelect', valueOptions: parentIdOptions ?? [] },
    { field: 'assignee_id', headerName: 'Assignee', width: 200, editable: editable, type: 'singleSelect', valueOptions: assigneeIdOptions ?? [] },
  ];
}
