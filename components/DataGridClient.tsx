'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { DataGrid, GridColDef, gridRowSelectionManagerSelector, useGridApiRef, GridRowSelectionModel } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import type { ModelPermissions } from '@/lib/authz';

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
  removeAction?: (formDataOrIds: FormData | string[]) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  primaryField?: keyof T;
}

export default function DataGridClient<T extends BaseEntity>({
  src,
  basePath,
  removeAction,
  entityLabel = 'Item',
  displayFields,
  permissions = { create: true, read: true, update: true, delete: true },
  primaryField = 'name' as keyof T,
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
    if (selectedIds.length > 0 && removeAction) {
      startTransition(() => removeAction(selectedIds));
    }
    setOpenDeleteDialog(false);
  };

  const tf = useTranslations('Fields');
  // Build dynamic columns based on displayFields, with name as default first column
  const defaultDisplayFields: DisplayFieldConfig<T>[] = displayFields || [
    { field: 'name' as keyof T, headerName: tf('name'), width: 200 },
    { field: 'description' as keyof T, headerName: tf('description'), width: 400 }
  ];

  const dataColumns: GridColDef<T>[] = defaultDisplayFields.map(fieldConfig => {
    // Special handling for primary field to include link to view page
    if (fieldConfig.field === primaryField) {
      return {
        field: fieldConfig.field as string,
        headerName: fieldConfig.headerName,
        width: fieldConfig.width || 150,
        renderCell: (params) => {
          const fieldValue = params.row[fieldConfig.field];
          return <Link href={`${basePath}/view/${params.id}`}>
            {`${(fieldValue && typeof fieldValue === 'object' && 'name' in fieldValue ? fieldValue.name : String(fieldValue || params.id))}`}
          </Link>;
        },
      };
    }

    return {
      field: fieldConfig.field as string,
      headerName: fieldConfig.headerName,
      width: fieldConfig.width || 200,
      valueGetter: (value, row) => {
        const fieldValue = row[fieldConfig.field];
        return fieldValue !== null && fieldValue !== undefined ?
        (typeof fieldValue === 'object' && 'name' in fieldValue ? fieldValue.name : String(fieldValue)) : '';
      },
    };
  });

  const columns: GridColDef<T>[] = dataColumns;
  if (permissions.update) columns.push(
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        return (
          <Link href={`${basePath}/edit/${params.id}`}>
            <Tooltip title="Edit">
              <IconButton size="small" aria-label="Edit" color="primary">
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Link>
        );
      },
    },
  );

  return (
    <div>
      <div className="flex mb-4">
        {permissions.create && (
        <Link href={`${basePath}/new`}>
          <Tooltip title={`Create New ${entityLabel}`}>
            <IconButton color="primary" aria-label={`Create New ${entityLabel}`}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Link>
        )}
        {permissions.delete && (
        <Tooltip title="Delete Selected">
          <span>
            <IconButton
              onClick={deleteSelected}
              color="error"
              aria-label="Delete Selected"
              disabled={selectedRowIds.ids.size === 0}
              sx={{ mx: 1 }}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
        )}
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
          <Button onClick={deleteConfirmed} color="error" variant="contained" aria-label="Delete">Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
