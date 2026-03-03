import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/permission/types';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
  import FormControlLabel from '@mui/material/FormControlLabel';
  import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Permission</h1>
        <div>
        {canEdit && (
          <Tooltip title="Edit">
            <Link href={`/permission/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
          <Tooltip title="Back to List">
            <Link href="/permission" aria-label="Back to List">
              <IconButton component="span" tabIndex={-1}>
                <ArrowBackIcon />
              </IconButton>
            </Link>
          </Tooltip>
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
        label="Role Id"
        value={src.role?.name || src.role_id || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.create)} readOnly />}
        label="Create"
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.read)} readOnly />}
        label="Read"
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.update)} readOnly />}
        label="Update"
      />
      <FormControlLabel
        control={<Checkbox checked={Boolean(src.delete)} readOnly />}
        label="Delete"
      />
      <AuditInfo src={src} />
    </div>
  );
}
