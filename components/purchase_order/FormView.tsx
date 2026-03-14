'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/purchase_order/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '@/components/_standard/FieldsViewGrid';
import { items_columns } from '../purchase_order/column_def';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '@/components/_standard/AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const itemsColumns: GridColDef[] = items_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('purchaseOrder')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/purchase_order/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/purchase_order" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('orderNo')}
        value={src.order_no || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('customer')}
        value={src.customer?.name || src.customer_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <h2>{tf('items')}</h2>
        <FieldsViewGrid fields={src.items} columns={itemsColumns} />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
