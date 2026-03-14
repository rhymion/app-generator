'use client';

import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/inventory/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '@/components/_standard/AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('inventory')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/inventory/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/inventory" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('product')}
        value={src.product?.name || src.product_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('quantity')}
        value={src.quantity || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('reservedQuantity')}
        value={src.reserved_quantity || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('location')}
        value={src.location || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('lotNumber')}
        value={src.lot_number || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label={tf('expirationDate')} date_time={src.expiration_date} show_time={false} readOnly />
      <AuditInfo src={src} />
    </div>
  );
}
