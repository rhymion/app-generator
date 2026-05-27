'use client';

import { useState, forwardRef, useImperativeHandle } from 'react';
import { DataGrid, GridColDef, GridRowsProp, GridValidRowModel, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
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
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';

interface OrderedFieldsDataGridProps {
  initialFields?: GridRowsProp;
  columns: GridColDef[];
  createNewRow: () => GridValidRowModel;
  addButtonLabel?: string;
  deleteDialogTitle?: string;
  deleteDialogMessage?: string;
  showTitle?: boolean;
  title?: string;
}

interface OrderedFieldsDataGridHandle {
  getFields: () => GridRowsProp;
}

function getDisplayValue(col: GridColDef, row: GridValidRowModel): string {
  const rawValue = row[col.field];
  if (col.valueGetter) {
    const result = (col.valueGetter as (...args: unknown[]) => unknown)(rawValue, row, col, null);
    if (result === null || result === undefined) return '';
    return String(result);
  }
  if (col.type === 'boolean') return Boolean(rawValue) ? 'Yes' : 'No';
  if (rawValue === null || rawValue === undefined) return '';
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

const OrderedFieldsDataGrid = forwardRef<OrderedFieldsDataGridHandle, OrderedFieldsDataGridProps>(
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
    const [fields, setFields] = useState<GridRowsProp>(() => {
      const sorted = [...initialFields].sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : 0;
        const orderB = typeof b.order === 'number' ? b.order : 0;
        return orderA - orderB;
      });
      return sorted.map((field, index) => ({ ...field, order: index + 1 }));
    });
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

    // Update order values whenever fields change
    const updateFieldsOrder = (updatedFields: GridRowsProp) => {
      const fieldsWithOrder = updatedFields.map((field, index) => ({
        ...field,
        order: index + 1,
      }));
      setFields(fieldsWithOrder);
    };

    useImperativeHandle(ref, () => ({
      getFields: () => fields,
    }), [fields]);

    function processRowUpdate(newRow: GridValidRowModel, oldRow: GridValidRowModel) {
      const updatedFields = fields.map(row => row.id === newRow.id ? { ...newRow, order: row.order } : row);
      setFields(updatedFields);
      return { ...newRow, order: oldRow.order };
    }

    function moveRowUp(index: number) {
      const newFields = [...fields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      updateFieldsOrder(newFields);
    }

    function moveRowDown(index: number) {
      const newFields = [...fields];
      [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      updateFieldsOrder(newFields);
    }

    const addField = () => {
      if (isMobile) {
        const newRow = createNewRow();
        setEditingRow(null);
        setEditValues({ ...newRow });
        setEditDialogOpen(true);
      } else {
        const newRow = createNewRow();
        const updatedFields = [...fields, newRow];
        updateFieldsOrder(updatedFields);
      }
    };

    const deleteSelectedConfirmed = () => {
      const selectedRows = apiRef.current?.getSelectedRows() || new Map();
      const updatedFields = fields.filter(row => !selectedRows.has(row.id));
      updateFieldsOrder(updatedFields);
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
        const updatedFields = fields.map(r =>
          r.id === editingRow.id ? { ...editValues, id: editingRow.id, order: r.order } : r
        );
        setFields(updatedFields);
      } else {
        const newRow = { ...editValues, id: `temp-${Date.now()}-${Math.random()}` };
        updateFieldsOrder([...fields, newRow]);
      }
      setEditDialogOpen(false);
    };

    const handleDeleteRow = () => {
      if (deleteRowId) {
        const updatedFields = fields.filter(r => r.id !== deleteRowId);
        updateFieldsOrder(updatedFields);
        setDeleteRowId(null);
      }
    };

    // Make order column read-only and add up/down buttons to columns
    const columnsWithActions: GridColDef[] = [
      ...columns.map(col =>
        col.field === 'order'
          ? { ...col, editable: false }
          : col
      ),
      {
        field: 'actions',
        headerName: 'Actions',
        width: 150,
        sortable: false,
        filterable: false,
        renderCell: (params) => {
          const index = fields.findIndex(f => f.id === params.id);
          return (
            <>
              <Button
                size="small"
                disabled={index === 0}
                onClick={() => {
                  const idx = fields.findIndex(f => f.id === params.id);
                  if (idx > 0) moveRowUp(idx);
                }}
                variant="outlined"
              >
                ↑
              </Button>
              <Button
                size="small"
                disabled={index === fields.length - 1}
                onClick={() => {
                  const idx = fields.findIndex(f => f.id === params.id);
                  if (idx < fields.length - 1) moveRowDown(idx);
                }}
                variant="outlined"
              >
                ↓
              </Button>
            </>
          );
        },
      },
    ];

    const editableColumns = columns.filter(col => col.editable && col.field !== 'id' && col.field !== 'order');
    const displayColumns = columns.filter(col => col.field !== 'id' && col.field !== 'actions');

    if (isMobile) {
      return (
        <div>
          {showTitle && <h2>{title}</h2>}
          <Tooltip title={addButtonLabel}>
            <IconButton color="primary" onClick={addField} aria-label={addButtonLabel} sx={{ mb: 2 }}>
              <AddIcon />
            </IconButton>
          </Tooltip>
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
                  <CardActions sx={{ justifyContent: 'space-between' }}>
                    <Box>
                      <Button size="small" disabled={index === 0} onClick={() => moveRowUp(index)} variant="outlined" sx={{ mr: 0.5 }}>↑</Button>
                      <Button size="small" disabled={index === fields.length - 1} onClick={() => moveRowDown(index)} variant="outlined">↓</Button>
                    </Box>
                    <Box>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEditDialog(row)} aria-label="Edit">
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteRowId(String(row.id))} aria-label="Delete">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
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
              <Button onClick={handleEditSave} color="primary" variant="contained">Save</Button>
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
              <Button onClick={handleDeleteRow} color="error" variant="contained" aria-label="Delete">Delete</Button>
            </DialogActions>
          </Dialog>
        </div>
      );
    }

    return (
      <div>
        {showTitle && <h2>{title}</h2>}
        <Tooltip title={addButtonLabel}>
          <IconButton color="primary" onClick={addField} aria-label={addButtonLabel} sx={{ mb: 2, mr: 1 }}>
            <AddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete Selected">
          <span>
            <IconButton
              onClick={deleteSelected}
              color="error"
              aria-label="Delete Selected"
              disabled={selectedRowIds.ids.size === 0}
              sx={{ mb: 2 }}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
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
            <Button onClick={deleteSelectedConfirmed} color="error" variant="contained" aria-label="Delete">Delete</Button>
          </DialogActions>
        </Dialog>
      </div>
    );
  }
);

OrderedFieldsDataGrid.displayName = 'OrderedFieldsDataGrid';

export default OrderedFieldsDataGrid;
