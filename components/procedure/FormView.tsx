import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/procedure/types';
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
        <h1>Procedure</h1>
        <div>
          {canEdit && (
            <Link href={`/procedure/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
          <Link href="/procedure"><Button variant="outlined">Back to List</Button></Link>
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
      <div>
        <ListWrapper
          items={src.preceded_by.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="Preceded By"
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
          title="Followed By"
        />
      </div>
    </div>
  );
}
