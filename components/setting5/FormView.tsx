import { GridColDef } from '@mui/x-data-grid';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/setting5/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { yyyyy_yyyyys_columns } from '../setting5/column_def';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  const yyyyyYyyyysColumns: GridColDef[] = yyyyy_yyyyys_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Setting5</h1>
        <div>
          {canEdit && (
            <Tooltip title="Edit">
              <Link href={`/setting5/edit/${src.id}`} sx={{ mx: 1 }} aria-label="Edit">
                <IconButton component="span" color="primary" tabIndex={-1}>
                  <EditIcon />
                </IconButton>
              </Link>
            </Tooltip>
          )}
          <Tooltip title="Back to List">
            <Link href="/setting5" aria-label="Back to List">
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
      <div>
        <h2>Yyyyy Yyyyys</h2>
        <FieldsViewGrid fields={src.yyyyy_yyyyys} columns={yyyyyYyyyysColumns} />
      </div>
      <AuditInfo src={src} />
    </div>
  );
}
