import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/permission/types';
import Link from '@mui/material/Link';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src }: FormViewProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Permission</h1>
        <div>
          <Link href={`/permission/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/permission"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
      <TextField
        label="Name"
        value={src.name || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <FormControlLabel 
        control={<Checkbox checked={src.create} aria-readonly />} 
        label="Create" 
      />
      <FormControlLabel 
        control={<Checkbox checked={src.read} aria-readonly />} 
        label="Read" 
      />
      <FormControlLabel 
        control={<Checkbox checked={src.update} aria-readonly />} 
        label="Update" 
      />
      <FormControlLabel 
        control={<Checkbox checked={src.remove} aria-readonly />} 
        label="Remove" 
      />
      <TextField
        label="Role Id"
        value={src.role?.name || src.role_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
    </div>
  );
}
