'use client';

import { useState, forwardRef, useImperativeHandle, useEffect } from 'react';
import { DataGrid, GridColDef, GridRowsProp, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';

interface OrderedFieldsDataGridProps {
  initialFields?: GridRowsProp;
  columns: GridColDef[];
  createNewRow: () => any;
  addButtonLabel?: string;
  deleteDialogTitle?: string;
  deleteDialogMessage?: string;
  showTitle?: boolean;
  title?: string;
}

interface OrderedFieldsDataGridHandle {
  getFields: () => GridRowsProp;
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
    const [fields, setFields] = useState<GridRowsProp>([]);
    const [paginationModel, setPaginationModel] = useState({
      pageSize: 10,
      page: 0,
    });
    const [openDeleteSelectedDialog, setOpenDeleteSelectedDialog] = useState(false);
    const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

    // Initialize fields: sort by order first, then ensure sequential order values
    useEffect(() => {
      // Sort by existing order field (ascending)
      const sortedFields = [...initialFields].sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : 0;
        const orderB = typeof b.order === 'number' ? b.order : 0;
        return orderA - orderB;
      });
      
      // Re-assign order values to be sequential (1, 2, 3, ...)
      const fieldsWithOrder = sortedFields.map((field, index) => ({
        ...field,
        order: index + 1,
      }));
      setFields(fieldsWithOrder);
    }, [initialFields]);

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

    function processRowUpdate(newRow: any, oldRow: any) {
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
      const newRow = createNewRow();
      const updatedFields = [...fields, newRow];
      updateFieldsOrder(updatedFields);
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

    return (
      <div>
        {showTitle && <h2>{title}</h2>}
        <Button onClick={addField} variant="contained" sx={{ mb: 2, mr: 2 }}>{addButtonLabel}</Button>
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
);

OrderedFieldsDataGrid.displayName = 'OrderedFieldsDataGrid';

export default OrderedFieldsDataGrid;
