import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';
import EntityAutocompleteCellEditor, { entityAutocompleteValueFormatter, type EntityAutocompleteCellConfig } from '@/components/_standard/EntityAutocompleteCellEditor';

export function usePrecededByColumns(editable: boolean = false, requestorRoleIdConfig?: EntityAutocompleteCellConfig, approverRoleIdConfig?: EntityAutocompleteCellConfig): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'entity_name', headerName: t('entityName'), width: 150, editable: editable },
    ...(requestorRoleIdConfig
      ? [{ field: 'requestor_role_id', headerName: t('requestorRole'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={requestorRoleIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(requestorRoleIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'requestor_role_id', headerName: t('requestorRole'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.requestor_role?.name ?? '' }]),
    ...(approverRoleIdConfig
      ? [{ field: 'approver_role_id', headerName: t('approverRole'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={approverRoleIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(approverRoleIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'approver_role_id', headerName: t('approverRole'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.approver_role?.name ?? '' }]),
  ];
}

export function useFollowedByColumns(editable: boolean = false, requestorRoleIdConfig?: EntityAutocompleteCellConfig, approverRoleIdConfig?: EntityAutocompleteCellConfig): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'entity_name', headerName: t('entityName'), width: 150, editable: editable },
    ...(requestorRoleIdConfig
      ? [{ field: 'requestor_role_id', headerName: t('requestorRole'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={requestorRoleIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(requestorRoleIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'requestor_role_id', headerName: t('requestorRole'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.requestor_role?.name ?? '' }]),
    ...(approverRoleIdConfig
      ? [{ field: 'approver_role_id', headerName: t('approverRole'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={approverRoleIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(approverRoleIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'approver_role_id', headerName: t('approverRole'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.approver_role?.name ?? '' }]),
  ];
}

