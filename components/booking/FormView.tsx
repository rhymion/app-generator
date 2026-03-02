import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/booking/types';
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
        <h1>Booking</h1>
        <div>
        {canEdit && (
          <Link href={`/booking/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
          <Link href="/booking"><Button variant="outlined">Back to List</Button></Link>
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
        label="Resource Id"
        value={src.resource?.name || src.resource_id || ''}
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
