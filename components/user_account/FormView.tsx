import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/user_account/types';
import Link from '@mui/material/Link';
import ImageDisplay from '../ImageDisplay';
import ListWrapper from '../ListWrapper';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;


  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>UserAccount</h1>
        <div>
          {canEdit && (
            <Link href={`/user_account/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
          <Link href="/user_account"><Button variant="outlined">Back to List</Button></Link>
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
      <TextField
        label="Api Key"
        value={src.api_key || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <ImageDisplay url={src.avatar} alt="Avatar" />
      <div>
        <ListWrapper
          items={src.roles.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="Role"
        />
      </div>
    </div>
  );
}
