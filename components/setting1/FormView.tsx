'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/setting1/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '@/components/_standard/FieldsViewGrid';
import { yyyyy_yyyyys_columns } from '../setting1/column_def';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '@/components/_standard/AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const yyyyyYyyyysColumns: GridColDef[] = yyyyy_yyyyys_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('setting1')}</h1>
        <div>
          {canEdit && (
            <Tooltip title="Edit">
              <Link href={`/setting1/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
                <IconButton component="span" color="primary" tabIndex={-1}>
                  <EditIcon />
                </IconButton>
              </Link>
            </Tooltip>
          )}
          <Tooltip title="Back to List">
            <Link href="/setting1" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('name')}
        value={src.name || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('description')}
        value={src.description || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('team')}
        value={src.team || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <h2>{tf('yyyyyYyyyys')}</h2>
        <FieldsViewGrid fields={src.yyyyy_yyyyys} columns={yyyyyYyyyysColumns} />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
