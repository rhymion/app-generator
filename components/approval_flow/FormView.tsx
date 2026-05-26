'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/approval_flow/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InputAdornment from '@mui/material/InputAdornment';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
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
        <h1>{te('approvalFlow')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/approval_flow/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/approval_flow" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
        </div>
      </div>
      <TextField
        label={tf('entityName')}
        value={[{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }].find((o) => o.value === src.entity_name)?.label ?? src.entity_name ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('requestorRole')}
        value={((src.requestor_role?.name ?? '')) || src.requestor_role_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
        slotProps={{ input: { endAdornment: src.requestor_role_id ? (
          <InputAdornment position="end">
            <Tooltip title="View">
              <Link href={`/role/view/${src.requestor_role_id}`} aria-label="View Role">
                <IconButton component="span" size="small" tabIndex={-1}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Link>
            </Tooltip>
          </InputAdornment>
        ) : null } }}
      />
      <TextField
        label={tf('approverRole')}
        value={((src.approver_role?.name ?? '')) || src.approver_role_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
        slotProps={{ input: { endAdornment: src.approver_role_id ? (
          <InputAdornment position="end">
            <Tooltip title="View">
              <Link href={`/role/view/${src.approver_role_id}`} aria-label="View Role">
                <IconButton component="span" size="small" tabIndex={-1}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Link>
            </Tooltip>
          </InputAdornment>
        ) : null } }}
      />
      <div>
        <ListWrapper
          items={src.preceded_by.map(f => ({
            id: f.id,
            value: (f.approver_role?.name || ((f.entity_name ?? ''))),
            label: (f.approver_role?.name || ((f.entity_name ?? ''))),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('precededBy')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.followed_by.map(f => ({
            id: f.id,
            value: (f.approver_role?.name || ((f.entity_name ?? ''))),
            label: (f.approver_role?.name || ((f.entity_name ?? ''))),
          }))}
          itemType="text"
          showTitle={true}
          title={tf('followedBy')}
        />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
