'use client';

import { useTranslations } from 'next-intl';
import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/parent1/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '@/components/_standard/FieldsViewGrid';
import { parent1_child1s_columns, parent1_child2s_columns } from '../parent1/column_def';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DateTimeWrapper from '@/components/_standard/DateTimeWrapper';
import ImageDisplay from '@/components/_standard/ImageDisplay';
import ListWrapper from '@/components/_standard/ListWrapper';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '@/components/_standard/AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const canEdit = permissions?.update ?? true;
  const parent1Child1sColumns: GridColDef[] = parent1_child1s_columns(false);
  const parent1Child2sColumns: GridColDef[] = parent1_child2s_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{te('parent1')}</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/parent1/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/parent1" aria-label="Back to List">
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
        label={tf('organization')}
        value={src.organization?.name || src.organization_id || ''}
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
        label={tf('price')}
        value={src.price || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label={tf('dueDate')} date_time={src.due_date} readOnly />
      <ImageDisplay url={src.image_url} alt={tf('imageUrl')} />
      <div>
        <h2>{tf('parent1Child1s')}</h2>
        <FieldsViewGrid fields={src.parent1_child1s} columns={parent1Child1sColumns} />
      </div>
      <div>
        <h2>{tf('parent1Child2s')}</h2>
        <FieldsViewGrid fields={src.parent1_child2s} columns={parent1Child2sColumns} />
      </div>
      <div>
        <ListWrapper
          items={src.parent1_lists.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title={tf('parent1Lists')}
        />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
