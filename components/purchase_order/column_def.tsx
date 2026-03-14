import { GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';

export function items_columns(editable: boolean = false, productIdOptions?: Array<{ value: string | null; label: string }>): GridColDef[] {
  const t = useTranslations('Fields');
  return [
    ...(productIdOptions && productIdOptions.length > 0
      ? [{ field: 'product_id', headerName: t('product'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: productIdOptions }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [{ field: 'product_id', headerName: t('product'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.product?.name ?? '' }]),
    { field: 'quantity', headerName: t('quantity'), width: 100, editable: editable, type: 'number' },
    { field: 'price', headerName: t('price'), width: 100, editable: editable, type: 'number' },
  ];
}

