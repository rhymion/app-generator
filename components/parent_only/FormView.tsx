import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/parent_only/types';
import Link from '@mui/material/Link';
import DateTimeWrapper from '../DateTimeWrapper';
  import FormControlLabel from '@mui/material/FormControlLabel';
  import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Parent Only</h1>
        <div>
        {canEdit && (
          <Link href={`/parent_only/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
          <Link href="/parent_only"><Button variant="outlined">Back to List</Button></Link>
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
      <DateTimeWrapper label="Login Time" date_time={src.login_time} readOnly />
      <DateTimeWrapper label="Logout Time" date_time={src.logout_time} readOnly />
      <AuditInfo src={src} />
    </div>
  );
}
