'use client';

import { useState } from 'react';
import { DataGrid, GridColDef, GridRowsProp, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';

interface FieldsDataGridProps {
  fields: GridRowsProp;
  onFieldsChange: (fields: GridRowsProp) => void;
  columns: GridColDef[];
  onAddField: () => void;
  addButtonLabel?: string;
  deleteDialogTitle?: string;
  deleteDialogMessage?: string;
}

export default function FieldsDataGrid({
  fields,
  onFieldsChange,
  columns,
  onAddField,
  addButtonLabel = 'Add Field',
  deleteDialogTitle = 'Delete Selected Fields?',
  deleteDialogMessage = 'Are you sure you want to delete the selected field(s)? This action cannot be undone.',
}: FieldsDataGridProps) {
  const apiRef = useGridApiRef();
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 10,
    page: 0,
  });
  const [openDeleteSelectedDialog, setOpenDeleteSelectedDialog] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

  function processRowUpdate(newRow: any, oldRow: any) {
    const updatedFields = fields.map(row => row.id === newRow.id ? newRow : row);
    onFieldsChange(updatedFields);
    return newRow;
  }

  function moveRowUp(index: number) {
    const newFields = [...fields];
    [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
    onFieldsChange(newFields);
  }

  function moveRowDown(index: number) {
    const newFields = [...fields];
    [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
    onFieldsChange(newFields);
  }

  const deleteSelectedConfirmed = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    const updatedFields = fields.filter(row => !selectedRows.has(row.id));
    onFieldsChange(updatedFields);
    setOpenDeleteSelectedDialog(false);
  };

  const deleteSelected = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    if (selectedRows.size === 0) return;
    setOpenDeleteSelectedDialog(true);
  };

  // Add up/down buttons to columns
  const columnsWithActions: GridColDef[] = [
    ...columns,
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      filterable: false,
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

  return (
    <div>
      <h2>Fields</h2>
      <Button onClick={onAddField} variant="contained" sx={{ mb: 2, mr: 2 }}>{addButtonLabel}</Button>
      <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mb: 2 }} disabled={selectedRowIds.ids.size === 0}>Delete Selected</Button>
      <Paper sx={{ height: 400, width: '100%' }}>
        <DataGrid
          apiRef={apiRef}
          rows={fields}
          columns={columnsWithActions}
          editMode="row"
          processRowUpdate={processRowUpdate}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowSelectionModelChange={setSelectedRowIds}
          pageSizeOptions={[10, 20, 50]}
          checkboxSelection
        />
      </Paper>

      {/* Delete Selected Dialog */}
      <Dialog
        open={openDeleteSelectedDialog}
        onClose={() => setOpenDeleteSelectedDialog(false)}
        aria-labelledby="delete-selected-dialog-title"
      >
        <DialogTitle id="delete-selected-dialog-title">{deleteDialogTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteDialogMessage}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteSelectedDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={deleteSelectedConfirmed} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
