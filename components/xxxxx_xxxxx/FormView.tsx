import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/xxxxx_xxxxx/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { yyyyy_yyyyy_columns } from '../xxxxx_xxxxx/column_def';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  const yyyyy_yyyyyColumns: GridColDef[] = yyyyy_yyyyy_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Xxxxx Xxxxx</h1>
        <div>
          {canEdit && (
            <Link href={`/xxxxx_xxxxx/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
          <Link href="/xxxxx_xxxxx"><Button variant="outlined">Back to List</Button></Link>
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
        label="Team"
        value={src.team || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <div>
        <h2>Yyyyy Yyyyy</h2>
        <FieldsViewGrid fields={src.yyyyy_yyyyys} columns={yyyyy_yyyyyColumns} />
      </div>
    </div>
  );
}
