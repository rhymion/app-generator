import type { GridColDef } from '@/components/ui/data';
import { useTranslations } from 'next-intl';

export function useCharactersColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'name', headerName: t('name'), width: 150, editable: editable },
    { field: 'official_image', headerName: t('officialImage'), width: 100, editable: editable, type: 'boolean' },
  ];
}

export function useScenesColumns(editable: boolean = false): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    { field: 'label', headerName: t('label'), width: 150, editable: editable },
    { field: 'episode', headerName: t('episode'), width: 150, editable: editable },
    { field: 'timestamp', headerName: t('timestamp'), width: 150, editable: editable },
  ];
}

