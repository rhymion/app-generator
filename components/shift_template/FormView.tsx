'use client';

import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/shift_template/types';
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
  const dayOfWeekOptions = [{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }];
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('shiftTemplate')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/shift_template/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/shift_template" aria-label="Back to List">
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
        label={tf('dayOfWeek')}
        value={dayOfWeekOptions.find(o => o.value === src.day_of_week)?.label ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label={tf('startTime')} date_time={src.start_time} show_date={false} readOnly />
      <DateTimeWrapper label={tf('endTime')} date_time={src.end_time} show_date={false} readOnly />
      <AuditInfo src={src} />
    </div>
  );
}
