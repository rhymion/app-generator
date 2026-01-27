import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/parent_only/types';
import Link from '@mui/material/Link';

export default function FormView({ src }: FormViewProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>ParentOnly</h1>
        <div>
          <Link href={`/parent_only/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/parent_only"><Button variant="outlined">Back to List</Button></Link>
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
        label="Login Time"
        value={src.login_time || ''}
        fullWidth
        margin="normal"
        disabled
      />
      <TextField
        label="Logout Time"
        value={src.logout_time || ''}
        fullWidth
        margin="normal"
        disabled
      />
    </div>
  );
}
