'use client';
import { useState, useTransition } from 'react';
import { DataGrid, GridColDef, gridRowSelectionManagerSelector, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';

interface BaseEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface DisplayFieldConfig<T> {
  field: keyof T;
  headerName: string;
  width?: number;
}

interface DataGridClientProps<T extends BaseEntity> {
  src: T[];
  basePath: string;
  removeAction: (formDataOrIds: FormData | string[]) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
}

export default function DataGridClient<T extends BaseEntity>({ 
  src, 
  basePath,
  removeAction,
  entityLabel = 'Item',
  displayFields
}: DataGridClientProps<T>) {
  const [items, setItems] = useState(src);
  const [isPending, startTransition] = useTransition();
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 10,
    page: 0,
  });
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
  const apiRef = useGridApiRef();

  function moveRowUp(index: number) {
    setItems(prev => {
      const newItems = [...prev];
      [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
      return newItems;
    });
  }

  function moveRowDown(index: number) {
    setItems(prev => {
      const newItems = [...prev];
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
      return newItems;
    });
  }

  const deleteSelected = () => {
    setOpenDeleteDialog(true);
  };

  const deleteConfirmed = () => {
    const selectedRows = apiRef.current?.getSelectedRows() || new Map();
    const selectedIds = Array.from(selectedRows.keys());
    if (selectedIds.length > 0) {
      startTransition(() => removeAction(selectedIds));
    }
    setOpenDeleteDialog(false);
  };

//   const deleteItem = (id: string) => {
//     startTransition(() => removeAction([id]));
//   };

  // Build dynamic columns based on displayFields, with name as default first column
  const defaultDisplayFields: DisplayFieldConfig<T>[] = displayFields || [
    { field: 'name' as keyof T, headerName: 'Name', width: 200 },
    { field: 'description' as keyof T, headerName: 'Description', width: 400 }
  ];

  const dataColumns: GridColDef<T>[] = defaultDisplayFields.map(fieldConfig => {
    // Special handling for name field to include link to view page
    if (fieldConfig.field === 'name') {
      return {
        field: fieldConfig.field as string,
        headerName: fieldConfig.headerName,
        width: fieldConfig.width || 150,
        renderCell: (params) => {
          const nameValue = params.row[fieldConfig.field];
          return <Link href={`${basePath}/view/${params.id}`}>{String(nameValue || params.id)}</Link>;
        },
      };
    }
    
    return {
      field: fieldConfig.field as string,
      headerName: fieldConfig.headerName,
      width: fieldConfig.width || 200,
      valueGetter: (value, row) => {
        const fieldValue = row[fieldConfig.field];
        return fieldValue !== null && fieldValue !== undefined ? String(fieldValue) : '';
      },
    };
  });

  const columns: GridColDef<T>[] = [
    ...dataColumns,
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const index = items.findIndex(t => t.id === params.id);
        return (
          <>
            <Link href={`${basePath}/edit/${params.id}`}>
              <Button size="small" sx={{ mx: 1 }} variant="contained">Edit</Button>
            </Link>
            {/* <Button size="small" color="error" onClick={() => deleteItem(params.id)}>Delete</Button> */}
          </>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex mb-4">
        <Link href={`${basePath}/new`}>
          <Button variant="contained">Create New {entityLabel}</Button>
        </Link>
        <Button onClick={deleteSelected} variant="contained" color="error" sx={{ mx: 2 }} disabled={selectedRowIds.ids.size === 0}>Delete Selected</Button>
      </div>
      <Paper sx={{ height: 500, width: '100%' }}>
        <DataGrid
          apiRef={apiRef}
          rows={items}
          columns={columns}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowSelectionModelChange={setSelectedRowIds}
          pageSizeOptions={[10, 20, 50]}
          checkboxSelection
          sx={{ border: 0 }}
        />
      </Paper>
      {/* Delete Table Dialog */}
      <Dialog
        open={openDeleteDialog}
        onClose={() => setOpenDeleteDialog(false)}
        aria-labelledby="delete-dialog-title"
      >
        <DialogTitle id="delete-dialog-title">Delete {entityLabel}(s)?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the {entityLabel}(s)? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={deleteConfirmed} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
