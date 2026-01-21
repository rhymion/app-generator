'use client';

import { useState } from 'react';
import { GridColDef, GridRowsProp } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { upsertDbTable, removeDbTable } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import FieldsDataGrid from './FieldsDataGrid';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const [name, setName] = useState(src.name);
  const [description, setDescription] = useState(src.description || '');
  const [fields, setFields] = useState<GridRowsProp>(src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));
  const [openDeleteTableDialog, setOpenDeleteTableDialog] = useState(false);
  const [openBackDialog, setOpenBackDialog] = useState(false);

  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 150, editable: true },
    { field: 'type', headerName: 'Type', width: 100, editable: true },
    { field: 'max_length', headerName: 'Max Length', width: 120, editable: true, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: true, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: true },
    { field: 'required', headerName: 'Required', width: 100, editable: true, type: 'boolean' },
  ];

  const addField = () => {
    const newField = {
      id: `temp-${Date.now()}-${Math.random()}`,
      name: '',
      type: 'string',
      table_id: src.id,
      max_length: null,
      max: null,
      regex: null,
      required: false,
    };
    setFields(prev => [...prev, newField]);
  };

  const handleSubmit = async (formData: FormData) => {
    formData.set('name', name);
    formData.set('description', description);
    if (isEdit) {
      formData.set('id', src.id);
    }
    // Serialize fields
    fields.forEach((field, index) => {
      formData.append('fields[]', JSON.stringify({
        id: field.id.startsWith('temp-') ? undefined : field.id,
        name: field.name,
        type: field.type,
        max_length: field.max_length,
        max: field.max,
        regex: field.regex,
        required: field.required,
      }));
    });
    await upsertDbTable(formData);
  };

  const handleDeleteConfirmed = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await removeDbTable(formData);
    setOpenDeleteTableDialog(false);
  };

  const handleBackConfirmed = () => {
    setOpenBackDialog(false);
    window.location.href = '/db_table';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{isEdit ? 'Edit' : 'Add'} DB Table</h1>
        <Button variant="outlined" onClick={() => setOpenBackDialog(true)}>Back to List</Button>
      </div>
      <form action={handleSubmit}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          margin="normal"
          required
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          margin="normal"
        />
        <FieldsDataGrid
          fields={fields}
          onFieldsChange={setFields}
          columns={columns}
          onAddField={addField}
          addButtonLabel="Add Field"
          deleteDialogTitle="Delete Selected Fields?"
          deleteDialogMessage="Are you sure you want to delete the selected field(s)? This action cannot be undone."
        />
        <Button type="submit" variant="contained" sx={{ mt: 2, mr: 2 }}>
          Save
        </Button>
        {isEdit && (
          <Button onClick={() => setOpenDeleteTableDialog(true)} variant="contained" color="error" sx={{ mt: 2 }}>
            Delete Table
          </Button>
        )}
      </form>

      {/* Delete Table Dialog */}
      <Dialog
        open={openDeleteTableDialog}
        onClose={() => setOpenDeleteTableDialog(false)}
        aria-labelledby="delete-table-dialog-title"
      >
        <DialogTitle id="delete-table-dialog-title">Delete Table?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this table? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteTableDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={handleDeleteConfirmed} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Back to List Dialog */}
      <Dialog
        open={openBackDialog}
        onClose={() => setOpenBackDialog(false)}
        aria-labelledby="back-dialog-title"
      >
        <DialogTitle id="back-dialog-title">Go Back?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any unsaved changes will be lost. Are you sure you want to go back to the list?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenBackDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={handleBackConfirmed} color="primary" variant="contained">Go Back</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}