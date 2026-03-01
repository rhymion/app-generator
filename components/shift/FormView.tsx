import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/shift/types';
import Link from '@mui/material/Link';
import DateTimeWrapper from '../DateTimeWrapper';
  import FormControlLabel from '@mui/material/FormControlLabel';
  import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  const statusOptions = [{ value: 0, label: 'Scheduled' }, { value: 1, label: 'Approved' }, { value: 2, label: 'Cancelled' }];
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Shift</h1>
        <div>
        {canEdit && (
          <Link href={`/shift/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
          <Link href="/shift"><Button variant="outlined">Back to List</Button></Link>
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
        label="Status"
        value={statusOptions.find(o => o.value === src.status)?.label ?? ''}
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
