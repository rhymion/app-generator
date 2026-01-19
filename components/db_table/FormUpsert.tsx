'use client';

import { useState } from 'react';
import { DataGrid, GridColDef, GridRowsProp, useGridApiRef, GridRowId } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { upsertDbTable, removeDbTable } from '@/lib/db_table/actions';
import type { FormUpsertProps } from '@/lib/db_table/types';
import Link from '@mui/material/Link';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const [name, setName] = useState(src.name);
  const [description, setDescription] = useState(src.description || '');
  const [fields, setFields] = useState<GridRowsProp>(src.fields.map(f => ({ ...f, id: f.id || `temp-${Date.now()}-${Math.random()}` })));
  const apiRef = useGridApiRef();
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 10,
    page: 0,
  });
  const [openDeleteSelectedDialog, setOpenDeleteSelectedDialog] = useState(false);
  const [openDeleteTableDialog, setOpenDeleteTableDialog] = useState(false);
  const [openBackDialog, setOpenBackDialog] = useState(false);

  function processRowUpdate(newRow: any, oldRow: any) {
    setFields(prev => prev.map(row => row.id === newRow.id ? newRow : row));
    return newRow;
  }

  function moveRowUp(index: number) {
    setFields(prev => {
      const newFields = [...prev];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      return newFields;
    });
  }

  function moveRowDown(index: number) {
    setFields(prev => {
      const newFields = [...prev];
      [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      return newFields;
    });
  }

  const deleteSelectedConfirmed = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    setFields(prev => prev.filter(row => !selectedRows.has(row.id)));
    setOpenDeleteSelectedDialog(false);
  };

  const deleteSelected = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    if (selectedRows.size === 0) return;
    setOpenDeleteSelectedDialog(true);
  };

  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 150, editable: true },
    { field: 'type', headerName: 'Type', width: 100, editable: true },
    { field: 'max_length', headerName: 'Max Length', width: 120, editable: true, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: true, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: true },
    { field: 'required', headerName: 'Required', width: 100, editable: true, type: 'boolean' },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      renderCell: (params) => {
        const index = fields.findIndex(f => f.id === params.id);
        return (
          <>
            <Button size="small" disabled={index === 0} onClick={() => moveRowUp(index)}>↑</Button>
            <Button size="small" disabled={index === fields.length - 1} onClick={() => moveRowDown(index)}>↓</Button>
          </>
        );
      },
    },
  ];

  const addField = () => {
    // Commit any pending row edit
    const api = apiRef.current;
    if (api) {
      const editingRowId = api.getAllRowIds().find(id => api.getRowMode(id) === 'edit');
      if (editingRowId) {
        api.stopRowEditMode({ id: editingRowId, ignoreModifications: false });
      }
    }
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

  const removeField = (id: string) => {
    setFields(prev => prev.filter(row => row.id !== id));
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
        <h2>Fields</h2>
        <Button onClick={addField} variant="contained" sx={{ mb: 2, mr: 2 }}>Add Field</Button>
        <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mb: 2 }}>Delete Selected</Button>
        <Paper sx={{ height: 400, width: '100%' }}>
          <DataGrid
            apiRef={apiRef}
            rows={fields}
            columns={columns}
            editMode="row"
            processRowUpdate={processRowUpdate}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 20, 50]}
            checkboxSelection
          />
        </Paper>
        <Button type="submit" variant="contained" sx={{ mt: 2, mr: 2 }}>
          Save
        </Button>
        {isEdit && (
          <Button onClick={() => setOpenDeleteTableDialog(true)} variant="contained" color="error" sx={{ mt: 2 }}>
            Delete Table
          </Button>
        )}
      </form>

      {/* Delete Selected Dialog */}
      <Dialog
        open={openDeleteSelectedDialog}
        onClose={() => setOpenDeleteSelectedDialog(false)}
        aria-labelledby="delete-selected-dialog-title"
      >
        <DialogTitle id="delete-selected-dialog-title">Delete Selected Fields?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the selected field(s)? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteSelectedDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={deleteSelectedConfirmed} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

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