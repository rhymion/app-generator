import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/parent_only/types';
import Link from '@mui/material/Link';
import DateTimeWrapper from '../DateTimeWrapper';

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
      <DateTimeWrapper label="Login Time" date_time={src.login_time} />
      <DateTimeWrapper label="Logout Time" date_time={src.logout_time} />
    </div>
  );
}
