'use client';

import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/permission/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InputAdornment from '@mui/material/InputAdornment';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
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
        <h1>{te('permission')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/permission/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/permission" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('name')}
        value={[{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }].find((o) => o.value === src.name)?.label ?? src.name ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('role')}
        value={((src.role?.name ?? '')) || src.role_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
        slotProps={{ input: { endAdornment: src.role_id ? (
          <InputAdornment position="end">
            <Tooltip title="View">
              <Link href={`/role/view/${src.role_id}`} aria-label="View Role">
                <IconButton component="span" size="small" tabIndex={-1}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Link>
            </Tooltip>
          </InputAdornment>
        ) : null } }}
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.create)} readOnly />}
        label={tf('create')}
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.read)} readOnly />}
        label={tf('read')}
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.update)} readOnly />}
        label={tf('update')}
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.delete)} readOnly />}
        label={tf('delete')}
      />
      <AuditInfo src={src} />
    </div>
  );
}
