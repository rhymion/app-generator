'use client';

import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/shift/types';
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
  const statusOptions = [{ value: 0, label: 'Scheduled' }, { value: 1, label: 'Approved' }, { value: 2, label: 'Cancelled' }];
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('shift')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/shift/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/shift" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('userAccount')}
        value={src.user_account?.name || src.user_account_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('status')}
        value={statusOptions.find(o => o.value === src.status)?.label ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label={tf('startTime')} date_time={src.start_time} readOnly />
      <DateTimeWrapper label={tf('endTime')} date_time={src.end_time} readOnly />
      <AuditInfo src={src} />
    </div>
  );
}
