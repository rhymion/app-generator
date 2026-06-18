import type { GridColDef, GridRenderEditCellParams } from '@/components/ui/data';
import { useTranslations } from 'next-intl';
import EntityAutocompleteCellEditor, { entityAutocompleteValueFormatter, type EntityAutocompleteCellConfig } from '@/components/_standard/EntityAutocompleteCellEditor';

export function useVoicedCharactersColumns(editable: boolean = false, workIdConfig?: EntityAutocompleteCellConfig): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    ...(workIdConfig
      ? [{ field: 'work_id', headerName: t('work'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={workIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(workIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'work_id', headerName: t('work'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.work?.title ?? '' }]),
    { field: 'official_image', headerName: t('officialImage'), width: 100, editable: editable, type: 'boolean' },
  ];
}

export function useComposedMusicsColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'title', headerName: t('title'), width: 150, editable: editable },
    { field: 'kind', headerName: t('kind'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: 0, label: 'op' }, { value: 1, label: 'cd' }, { value: 2, label: 'bgm' }, { value: 3, label: 'insert' }] },
  ];
}

export function useCreditedMusicsColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'title', headerName: t('title'), width: 150, editable: editable },
    { field: 'kind', headerName: t('kind'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{ value: 0, label: 'op' }, { value: 1, label: 'cd' }, { value: 2, label: 'bgm' }, { value: 3, label: 'insert' }] },
  ];
}

export function useCreditedScenesColumns(editable: boolean = false, workIdConfig?: EntityAutocompleteCellConfig): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'label', headerName: t('label'), width: 150, editable: editable },
    ...(workIdConfig
      ? [{ field: 'work_id', headerName: t('work'), width: 200, editable: editable,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <EntityAutocompleteCellEditor {...params} config={workIdConfig} />
          ),
          valueFormatter: entityAutocompleteValueFormatter(workIdConfig) }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'work_id', headerName: t('work'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.work?.title ?? '' }]),
    { field: 'episode', headerName: t('episode'), width: 150, editable: editable },
    { field: 'timestamp', headerName: t('timestamp'), width: 150, editable: editable },
  ];
}

