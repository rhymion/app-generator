'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/product/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ListWrapper from '@/components/_standard/ListWrapper';
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
        <h1>{te('product')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/product/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/product" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('code')}
        value={src.code || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('name')}
        value={src.name || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('price')}
        value={src.price || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <ListWrapper
          items={src.images.map(f => ({
            id: f.id,
            value: f.path,
            label: f.name,
          }))}
          itemType="file"
          fileVariant="image"
          showTitle={true}
          title={tf('images')}
        />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
