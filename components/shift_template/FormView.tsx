import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/shift_template/types';
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
        <h1>Shift Template</h1>
        <div>
        {canEdit && (
          <Link href={`/shift_template/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
          <Link href="/shift_template"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
      <TextField
        label="User Account Id"
        value={src.user_account?.name || src.user_account_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <TextField
        label="Day Of Week"
        value={src.day_of_week || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label="Start Time" date_time={src.start_time} readOnly />
      <DateTimeWrapper label="End Time" date_time={src.end_time} readOnly />
      <AuditInfo src={src} />
    </div>
  );
}
