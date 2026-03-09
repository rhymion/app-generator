import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function children_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'description', headerName: t('description'), width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}

export function preceded_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'description', headerName: t('description'), width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}

export function followed_by_columns(editable: boolean = false, parentIdOptions?: Array<{ value: string | null; label: string }>, assigneeIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'description', headerName: t('description'), width: 150, editable: editable },
    ...(parentIdOptions && parentIdOptions.length > 0
      ? [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: parentIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_id', headerName: t('parent'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent?.name ?? '' }]),
    ...(assigneeIdOptions && assigneeIdOptions.length > 0
      ? [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: assigneeIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'assignee_id', headerName: t('assignee'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.assignee?.name ?? '' }]),
  ];
}

