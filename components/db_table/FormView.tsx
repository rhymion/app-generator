'use client';

import { useRouter } from 'next/navigation';
import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/db_table/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { fields_columns } from '../db_table/column_def';
import CommentListWrapper from '../CommentListWrapper';
import { addDbTableComment, updateDbTableComment, deleteDbTableComment } from '@/lib/db_table/actions';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AuditInfo from '../AuditInfo';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  const fieldsColumns: GridColDef[] = fields_columns(false);
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Db Table</h1>
        <div>
          {canEdit && (
            <Link href={`/db_table/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
          <Link href="/db_table"><Button variant="outlined">Back to List</Button></Link>
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
      <div>
        <h2>Fields</h2>
        <FieldsViewGrid fields={src.fields} columns={fieldsColumns} />
      </div>
      <CommentListWrapper
        comments={src.db_table_comments}
        showTitle={true}
        title="Db Table Comments"
        permissions={{ create: false, delete: false }}
      />
      <AuditInfo src={src} />
    </div>
  );
}
