import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/setting2/types';
import Link from '@mui/material/Link';
  import FormControlLabel from '@mui/material/FormControlLabel';
  import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Setting2</h1>
        <div>
        {canEdit && (
          <Link href={`/setting2/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
          <Link href="/setting2"><Button variant="outlined">Back to List</Button></Link>
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
        label="Email"
        value={src.email || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label="Password"
        value={src.password || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <AuditInfo src={src} />
    </div>
  );
}
