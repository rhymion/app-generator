'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/procedure/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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
        <h1>{te('procedure')}</h1>
        <div>
          {canEdit && (
            <Tooltip title="Edit">
              <Link href={`/procedure/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
                <IconButton component="span" color="primary" tabIndex={-1}>
                  <EditIcon />
                </IconButton>
              </Link>
            </Tooltip>
          )}
          <Tooltip title="Back to List">
            <Link href="/procedure" aria-label="Back to List">
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
        label={tf('parent')}
        value={src.parent?.name || src.parent_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label={tf('assignee')}
        value={src.assignee?.name || src.assignee_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <ListWrapper
          items={src.children.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title={tf('children')}
        />
      </div>
      <div>
        <ListWrapper
          items={src.preceded_by.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
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
            value: f.name,
            label: f.name,
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
