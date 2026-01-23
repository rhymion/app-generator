import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/xxxxx_xxxxx/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { field_columns } from '../xxxxx_xxxxx/column_def';

export default function FormView({ src }: FormViewProps) {
  const columns: GridColDef[] = field_columns(false);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>XxxxxXxxxx</h1>
        <div>
          <Link href={`/xxxxx_xxxxx/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/xxxxx_xxxxx"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
      <TextField
        label="Name"
        value={src.name || ''}
        fullWidth
        margin="normal"
        disabled
      />
      <TextField
        label="Description"
        value={src.description || ''}
        fullWidth
        margin="normal"
        disabled
      />
      <TextField
        label="Team"
        value={src.team || ''}
        fullWidth
        margin="normal"
        disabled
      />
      <div>
        <h2>YyyyyYyyyy</h2>
        <FieldsViewGrid fields={src.yyyyyYyyyy} columns={columns} />
      </div>
    </div>
  );
}
