import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/db_table/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';

export default function FormView({ src }: FormViewProps) {
  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'type', headerName: 'Type', width: 100 },
    { field: 'max_length', headerName: 'Max Length', width: 120, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150},
    { field: 'required', headerName: 'Required', width: 100, type: 'boolean' },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>DB Table</h1>
        <div>
          <Link href={`/db_table/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/db_table"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
      <form>
        <TextField
          label="Name"
          value={src.name}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Description"
          value={src.description}
          fullWidth
          margin="normal"
        />
        <h2>Fields</h2>
        <FieldsViewGrid fields={src.fields} columns={columns} />
      </form>
    </div>
  );
}
