import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/parent1/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { parent1_child1_columns, parent1_child2_columns } from '../parent1/column_def';
import DateTimeWrapper from '../DateTimeWrapper';
import ImageDisplay from '../ImageDisplay';

export default function FormView({ src }: FormViewProps) {
  const parent1_child1Columns: GridColDef[] = parent1_child1_columns(false);
  const parent1_child2Columns: GridColDef[] = parent1_child2_columns(false);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Parent1</h1>
        <div>
          <Link href={`/parent1/edit/${src.id}`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/parent1"><Button variant="outlined">Back to List</Button></Link>
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
      <TextField
        label="Price"
        value={src.price || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
      <DateTimeWrapper label="Due Date" date_time={src.due_date} show_time={false} readOnly />
      <ImageDisplay url={src.image_url} alt="Image" maxWidth="400px" maxHeight="400px" />
      <div>
        <h2>Parent1Child1</h2>
        <FieldsViewGrid fields={src.parent1_child1s} columns={parent1_child1Columns} />
      </div>
      <div>
        <h2>Parent1Child2</h2>
        <FieldsViewGrid fields={src.parent1_child2s} columns={parent1_child2Columns} />
      </div>
    </div>
  );
}
