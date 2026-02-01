import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/organization/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import ListWrapper from '../ListWrapper';

export default function FormView({ src }: FormViewProps) {


  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Organization</h1>
        <div>
          <Link href={`/organization/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/organization"><Button variant="outlined">Back to List</Button></Link>
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
          items={src.user_accounts.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="User Account"
        />
      </div>
    </div>
  );
}
