'use client';

import { useState, forwardRef, useImperativeHandle } from 'react';
import { DataGrid, GridColDef, GridRowsProp, GridValidRowModel, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import useMediaQuery from '@mui/material/useMediaQuery';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import DateTimeWrapper from './DateTimeWrapper';
import dayjs from 'dayjs';

interface FieldsDataGridProps {
  initialFields?: GridRowsProp;
  columns: GridColDef[];
  createNewRow: () => GridValidRowModel;
  addButtonLabel?: string;
  deleteDialogTitle?: string;
  deleteDialogMessage?: string;
  showTitle?: boolean;
  title?: string;
}

interface FieldsDataGridHandle {
  getFields: () => GridRowsProp;
}

function getDisplayValue(col: GridColDef, row: GridValidRowModel): string {
  const rawValue = row[col.field];
  if (col.valueGetter) {
    const result = (col.valueGetter as (...args: unknown[]) => unknown)(rawValue, row, col, null);
    if (result === null || result === undefined) return '';
    if (col.valueFormatter) {
      const formatted = (col.valueFormatter as (...args: unknown[]) => unknown)(result, row, col, null);
      return formatted === null || formatted === undefined ? '' : String(formatted);
    }
    return String(result);
  }
  if (col.type === 'boolean') return Boolean(rawValue) ? 'Yes' : 'No';
  if (rawValue === null || rawValue === undefined) return '';
  if (col.valueFormatter) {
    const formatted = (col.valueFormatter as (...args: unknown[]) => unknown)(rawValue, row, col, null);
    return formatted === null || formatted === undefined ? '' : String(formatted);
  }
  return String(rawValue);
}

function DialogField({ col, value, onChange }: { col: GridColDef; value: GridValidRowModel[string]; onChange: (v: GridValidRowModel[string]) => void }) {
  if (col.type === 'boolean') {
    return (
      <FormControlLabel
        control={<Checkbox checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />}
        label={col.headerName}
        sx={{ mt: 1, display: 'block' }}
      />
    );
  }
  if (col.type === 'dateTime') {
    const dateValue = value ? new Date(value) : null;
    const validDate = dateValue && !isNaN(dateValue.getTime()) ? dateValue : null;
    return (
      <DateTimeWrapper
        label={col.headerName || ''}
        date_time={validDate}
        onChange={(newValue: dayjs.Dayjs | null) => onChange(newValue ? newValue.toISOString() : '')}
      />
    );
  }
  if (col.type === 'singleSelect') {
    const opts = ((col as { valueOptions?: Array<{ value: string | null; label: string }> }).valueOptions as Array<{ value: string | null; label: string }>) ?? [];
    return (
      <FormControl fullWidth margin="normal">
        <InputLabel>{col.headerName}</InputLabel>
        <Select value={value ?? ''} label={col.headerName} onChange={e => onChange(e.target.value)}>
          {opts.map(opt => (
            <MenuItem key={String(opt.value)} value={opt.value ?? ''}>{opt.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }
  return (
    <TextField
      label={col.headerName}
      value={value ?? ''}
      type={col.type === 'number' ? 'number' : 'text'}
      onChange={e => onChange(col.type === 'number' ? Number(e.target.value) : e.target.value)}
      fullWidth
      margin="normal"
    />
  );
}

const FieldsDataGrid = forwardRef<FieldsDataGridHandle, FieldsDataGridProps>(
  ({
    initialFields = [],
    columns,
    createNewRow,
    addButtonLabel = 'Add Field',
    deleteDialogTitle = 'Delete Selected Fields?',
    deleteDialogMessage = 'Are you sure you want to delete the selected field(s)? This action cannot be undone.',
    showTitle = true,
    title = 'Fields',
  }, ref) => {
    const apiRef = useGridApiRef();
    const [fields, setFields] = useState<GridRowsProp>(initialFields);
    const [paginationModel, setPaginationModel] = useState({
      pageSize: 10,
      page: 0,
    });
    const [openDeleteSelectedDialog, setOpenDeleteSelectedDialog] = useState(false);
    const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
    const isMobile = useMediaQuery('(max-width: 768px)');

    // Mobile edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingRow, setEditingRow] = useState<GridValidRowModel | null>(null); // null = new row
    const [editValues, setEditValues] = useState<GridValidRowModel>({});
    const [deleteRowId, setDeleteRowId] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      getFields: () => fields,
    }), [fields]);

    function processRowUpdate(newRow: GridValidRowModel, oldRow: GridValidRowModel) {
      const updatedFields = fields.map(row => row.id === newRow.id ? newRow : row);
      setFields(updatedFields);
      return newRow;
    }

    function moveRowUp(index: number) {
      const newFields = [...fields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      setFields(newFields);
    }

    function moveRowDown(index: number) {
      const newFields = [...fields];
      [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      setFields(newFields);
    }

    const addField = () => {
      if (isMobile) {
        const newRow = createNewRow();
        setEditingRow(null);
        setEditValues({ ...newRow });
        setEditDialogOpen(true);
      } else {
        const newRow = createNewRow();
        setFields(prev => [...prev, newRow]);
      }
    };

    const deleteSelectedConfirmed = () => {
      const selectedRows = apiRef.current?.getSelectedRows() || new Map();
      const updatedFields = fields.filter(row => !selectedRows.has(row.id));
      setFields(updatedFields);
      setOpenDeleteSelectedDialog(false);
    };

    const deleteSelected = () => {
      const selectedRows = apiRef.current?.getSelectedRows() || new Map();
      if (selectedRows.size === 0) return;
      setOpenDeleteSelectedDialog(true);
    };

    const openEditDialog = (row: GridValidRowModel) => {
      setEditingRow(row);
      setEditValues({ ...row });
      setEditDialogOpen(true);
    };

    const handleEditSave = () => {
      if (editingRow) {
        setFields(prev => prev.map(r => r.id === editingRow.id ? { ...editValues, id: editingRow.id } : r));
      } else {
        setFields(prev => [...prev, { ...editValues, id: `temp-${Date.now()}-${Math.random()}` }]);
      }
      setEditDialogOpen(false);
    };

    const handleDeleteRow = () => {
      if (deleteRowId) {
        setFields(prev => prev.filter(r => r.id !== deleteRowId));
        setDeleteRowId(null);
      }
    };

    const editableColumns = columns.filter(col => col.editable && col.field !== 'id');
    const displayColumns = columns.filter(col => col.field !== 'id' && col.field !== 'actions');

    if (isMobile) {
      return (
        <div>
          {showTitle && <h2>{title}</h2>}
          <Button onClick={addField} variant="contained" sx={{ mb: 2 }}>{addButtonLabel}</Button>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {fields.length === 0 ? (
              <Typography color="text.secondary">No items.</Typography>
            ) : (
              fields.map((row, index) => (
                <Card key={row.id ?? index} variant="outlined">
                  <CardContent sx={{ pb: 0 }}>
                    {displayColumns.map(col => {
                      const displayValue = getDisplayValue(col, row);
                      if (!displayValue) return null;
                      return (
                        <Box key={col.field} sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary" component="span">
                            {col.headerName}:{' '}
                          </Typography>
                          <Typography variant="body2" component="span">
                            {displayValue}
                          </Typography>
                        </Box>
                      );
                    })}
                  </CardContent>
                  <CardActions sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => openEditDialog(row)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => setDeleteRowId(String(row.id))}>Delete</Button>
                  </CardActions>
                </Card>
              ))
            )}
          </Box>

          {/* Edit / Add Dialog */}
          <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{editingRow ? 'Edit Item' : 'Add Item'}</DialogTitle>
            <DialogContent>
              {editableColumns.map(col => (
                <DialogField
                  key={col.field}
                  col={col}
                  value={editValues[col.field]}
                  onChange={v => setEditValues((prev: GridValidRowModel) => ({ ...prev, [col.field]: v }))}
                />
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditDialogOpen(false)} color="inherit">Cancel</Button>
              <Button onClick={handleEditSave} variant="contained">Save</Button>
            </DialogActions>
          </Dialog>

          {/* Delete Row Confirmation */}
          <Dialog open={deleteRowId !== null} onClose={() => setDeleteRowId(null)}>
            <DialogTitle>Delete Item?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Are you sure you want to delete this item? This action cannot be undone.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteRowId(null)} color="inherit">Cancel</Button>
              <Button onClick={handleDeleteRow} color="error" variant="contained">Delete</Button>
            </DialogActions>
          </Dialog>
        </div>
      );
    }

    return (
      <div>
        {showTitle && <h2>{title}</h2>}
        <Button onClick={addField} variant="contained" sx={{ mb: 2, mr: 2 }}>{addButtonLabel}</Button>
        <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mb: 2 }} disabled={selectedRowIds.ids.size === 0}>Delete Selected</Button>
        <Paper sx={{ height: 400, width: '100%' }}>
          <DataGrid
            apiRef={apiRef}
            rows={fields}
            columns={columns}
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
);

FieldsDataGrid.displayName = 'FieldsDataGrid';

export default FieldsDataGrid;
