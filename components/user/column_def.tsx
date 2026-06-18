import type { GridColDef, GridRenderEditCellParams } from '@/components/ui/data';
import { useTranslations } from 'next-intl';
import EntityAutocompleteCellEditor, { entityAutocompleteValueFormatter, type EntityAutocompleteCellConfig } from '@/components/_standard/EntityAutocompleteCellEditor';

export function useRolesColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'description', headerName: t('description'), width: 150, editable: editable },
  ];
}

export function useSubAccountsColumns(editable: boolean = false, parentUserIdConfig?: EntityAutocompleteCellConfig): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    ...(parentUserIdConfig
      ? [{ field: 'parent_user_id', headerName: t('parentUser'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={parentUserIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(parentUserIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'parent_user_id', headerName: t('parentUser'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.parent_user?.name ?? '' }]),
    { field: 'nickname', headerName: t('nickname'), width: 150, editable: editable },
  ];
}

