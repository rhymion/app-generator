'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/setting/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ImageDisplay from '../ImageDisplay';
import ListWrapper from '../ListWrapper';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('setting')}</h1>
        <div>
          {canEdit && (
            <Tooltip title="Edit">
              <Link href={`/setting/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
                <IconButton component="span" color="primary" tabIndex={-1}>
                  <EditIcon />
                </IconButton>
              </Link>
            </Tooltip>
          )}
          <Tooltip title="Back to List">
            <Link href="/setting" aria-label="Back to List">
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
        label={tf('email')}
        value={src.email || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('password')}
        value={src.password || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('apiKey')}
        value={src.api_key || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <ImageDisplay url={src.avatar} alt={tf('avatar')} />
      <div>
        <ListWrapper
          items={src.roles.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="Roles"
        />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
