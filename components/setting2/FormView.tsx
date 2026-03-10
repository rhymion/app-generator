'use client';

import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/setting2/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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
        <h1>{te('setting2')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/setting2/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/setting2" aria-label="Back to List">
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
      <AuditInfo src={src} />
    </div>
  );
}
