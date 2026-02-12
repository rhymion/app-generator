import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/resource/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import ListWrapper from '../ListWrapper';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Resource</h1>
        <div>
          {canEdit && (
            <Link href={`/resource/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
          <Link href="/resource"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
      <TextField
        label="Name"
        value={src.name || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label="Description"
        value={src.description || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label="Organization Id"
        value={src.organization?.name || src.organization_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <ListWrapper
          items={src.resource_attachments.map(f => ({
            id: f.id,
            value: f.path,
            label: f.name,
          }))}
          itemType="file"
          fileVariant="file"
          showTitle={true}
          title="Resource Attachments"
        />
      </div>
      <div>
        <ListWrapper
          items={src.resource_images.map(f => ({
            id: f.id,
            value: f.path,
            label: f.name,
          }))}
          itemType="file"
          fileVariant="image"
          showTitle={true}
          title="Resource Images"
        />
      </div>
    </div>
  );
}
