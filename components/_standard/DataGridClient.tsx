'use client';
import { useState, useTransition, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { formatLabelValue } from '@/lib/_format';
import {
  DataGrid,
  GridColDef,
  GridFilterModel,
  GridPaginationModel,
  GridRowSelectionModel,
  GridSortModel,
  useGridApiRef,
} from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { Link as NextLink } from '@/i18n/navigation';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import type { ModelPermissions } from '@/lib/authz';
import type { PageOpts, PageResult } from '@/lib/_pagination';

interface BaseEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface DisplayFieldConfig<T> {
  field: keyof T;
  headerName: string;
  width?: number;
  format?: 'date-time' | 'date' | 'time';
  showSeconds?: boolean;
  enumLabels?: Record<number, string>;
  uriKind?: 'image' | 'link';
}

interface DataGridClientProps<T extends BaseEntity> {
  /** Client-mode rows. Required when fetchPage is not provided. */
  src?: T[];
  /** Server-mode initial page rows. Required when fetchPage is provided. */
  initialRows?: T[];
  /** Server-mode total row count (across all pages). */
  initialRowCount?: number;
  /** Server-mode initial page index (0-based). */
  initialPage?: number;
  /** Server-mode initial page size. */
  initialPageSize?: number;
  /** Server-mode page fetcher (Server Action). When provided, DataGrid runs in server-paginated mode. */
  fetchPage?: (opts: PageOpts) => Promise<PageResult<T>>;
  basePath: string;
  removeAction?: (ids: string[]) => Promise<void>;
  invalidateAction?: (id: string) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  primaryField?: keyof T;
  /** When true, edit and create links open in a new tab. Use in parent-embedded bridge grids. */
  openLinksInNewTab?: boolean;
  /** When false, the "+" create button is hidden even if the user has create permission.
   * Used for bridge-child entities, which cannot be created standalone (only via a parent). */
  allowCreate?: boolean;
}

export default function DataGridClient<T extends BaseEntity>({
  src,
  initialRows,
  initialRowCount,
  initialPage,
  initialPageSize,
  fetchPage,
  basePath,
  removeAction,
  invalidateAction,
  entityLabel = 'Item',
  displayFields,
  permissions = { create: true, read: true, update: true, delete: true, import: true },
  primaryField = 'name' as keyof T,
  openLinksInNewTab,
  allowCreate = true,
}: DataGridClientProps<T>) {
  const serverMode = typeof fetchPage === 'function';
  const initialItems: T[] = (serverMode ? initialRows : src) ?? [];

  const [items, setItems] = useState<T[]>(initialItems);
  const [rowCount, setRowCount] = useState<number>(
    serverMode ? (initialRowCount ?? initialItems.length) : initialItems.length,
  );
  const [isPending, startTransition] = useTransition();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    pageSize: serverMode ? (initialPageSize ?? 50) : 10,
    page: serverMode ? (initialPage ?? 0) : 0,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({ items: [] });
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openInvalidateDialog, setOpenInvalidateDialog] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingInvalidateId, setPendingInvalidateId] = useState<string | null>(null);
  const apiRef = useGridApiRef();
  const tc = useTranslations('Common');
  const tf = useTranslations('Fields');

  const reload = useCallback((p: GridPaginationModel, s: GridSortModel, f: GridFilterModel) => {
    if (!fetchPage) return;
    startTransition(async () => {
      const result = await fetchPage({
        page: p.page,
        pageSize: p.pageSize,
        sort: s.map(x => ({ field: x.field, dir: x.sort === 'desc' ? 'desc' : 'asc' })),
        filter: Object.fromEntries(
          f.items
            .filter(i => i.value !== undefined && i.value !== null && i.value !== '')
            .map(i => [i.field, i.value as string | number | boolean]),
        ),
      });
      setItems(result.rows as T[]);
      setRowCount(result.total);
    });
  }, [fetchPage]);

  const deleteSelected = () => {
    // Capture IDs now — before the Dialog opens and its focus trap causes
    // MUI DataGrid to fire onRowSelectionModelChange with an empty set.
    setPendingDeleteIds(Array.from(selectedRowIds.ids) as string[]);
    setOpenDeleteDialog(true);
  };

  const deleteConfirmed = () => {
    if (pendingDeleteIds.length > 0 && removeAction) {
      setItems(prev => prev.filter(item => !pendingDeleteIds.includes((item as { id: string }).id)));
      if (serverMode) setRowCount(prev => Math.max(0, prev - pendingDeleteIds.length));
      startTransition(() => removeAction(pendingDeleteIds));
    }
    setOpenDeleteDialog(false);
    setPendingDeleteIds([]);
  };

  const handleInvalidateClick = (id: string) => {
    setPendingInvalidateId(id);
    setOpenInvalidateDialog(true);
  };

  const invalidateConfirmed = () => {
    if (pendingInvalidateId && invalidateAction) {
      const id = pendingInvalidateId;
      startTransition(() => invalidateAction(id));
    }
    setOpenInvalidateDialog(false);
    setPendingInvalidateId(null);
  };

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
          // The link must stay within the cell's width. Without these styles
          // the `<a>` extends to its full text width and visually overlaps the
          // next column, which makes Cypress' `cy.click()` fail with "is being
          // covered by another element" because the next cell's div sits over
          // the overflowing portion of the link.
          return <NextLink
            href={`${basePath}/view/${params.id}`}
            style={{
              display: 'block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {`${(fieldValue && typeof fieldValue === 'object' && 'name' in fieldValue ? fieldValue.name : String(fieldValue || params.id))}`}
          </NextLink>;
        },
      };
    }

    if (fieldConfig.uriKind === 'link') {
      return {
        field: fieldConfig.field as string,
        headerName: fieldConfig.headerName,
        width: fieldConfig.width || 200,
        renderCell: (params) => {
          const href = params.row[fieldConfig.field] as string | null | undefined;
          if (!href) return null;
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '100%' }}>
              {href}
            </a>
          );
        },
      };
    }

    return {
      field: fieldConfig.field as string,
      headerName: fieldConfig.headerName,
      width: fieldConfig.width || 200,
      valueGetter: (value, row) => {
        const fieldValue = row[fieldConfig.field];
        if (fieldValue === null || fieldValue === undefined) return '';
        if (fieldConfig.format) return formatLabelValue(fieldValue, fieldConfig.format, fieldConfig.showSeconds);
        if (fieldConfig.enumLabels && typeof fieldValue === 'number') return fieldConfig.enumLabels[fieldValue] ?? String(fieldValue);
        if (typeof fieldValue === 'object' && 'name' in (fieldValue as object)) return (fieldValue as unknown as { name: string }).name;
        return String(fieldValue);
      },
    };
  });

  const columns: GridColDef<T>[] = dataColumns;
  if (permissions.update || invalidateAction) columns.push(
    {
      field: 'actions',
      headerName: tf('actions'),
      width: invalidateAction ? 120 : 80,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        return (
          <span style={{ display: 'flex', gap: 4 }}>
            {permissions.update && (
              <NextLink href={`${basePath}/edit/${params.id}`} target={openLinksInNewTab ? '_blank' : undefined} rel={openLinksInNewTab ? 'noopener noreferrer' : undefined}>
                <Tooltip title="Edit">
                  <IconButton size="small" aria-label="Edit" color="primary">
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </NextLink>
            )}
            {invalidateAction && (
              <Tooltip title="Invalidate (irreversible)">
                <IconButton
                  size="small"
                  aria-label="Invalidate"
                  color="warning"
                  onClick={() => handleInvalidateClick(params.id as string)}
                >
                  <PersonOffIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </span>
        );
      },
    },
  );

  return (
    <div>
      <div className="flex mb-4">
        {permissions.create && allowCreate && (
        <NextLink href={`${basePath}/new`}>
          <Tooltip title={`Create New ${entityLabel}`}>
            <IconButton color="primary" aria-label={`Create New ${entityLabel}`}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </NextLink>
        )}
        {permissions.delete && removeAction && (
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
          loading={isPending}
          {...(serverMode
            ? {
                rowCount,
                paginationMode: 'server' as const,
                sortingMode: 'server' as const,
                filterMode: 'server' as const,
                sortModel,
                onSortModelChange: (m: GridSortModel) => {
                  setSortModel(m);
                  reload(paginationModel, m, filterModel);
                },
                filterModel,
                onFilterModelChange: (m: GridFilterModel) => {
                  setFilterModel(m);
                  reload(paginationModel, sortModel, m);
                },
              }
            : {})}
          paginationModel={paginationModel}
          onPaginationModelChange={(m) => {
            setPaginationModel(m);
            if (serverMode) reload(m, sortModel, filterModel);
          }}
          onRowSelectionModelChange={setSelectedRowIds}
          pageSizeOptions={[10, 20, 50]}
          checkboxSelection
          disableVirtualization={typeof window !== 'undefined' && !!(window as unknown as { Cypress?: unknown }).Cypress}
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
            {tc('deleteMessage', { entity: entityLabel.toLowerCase() })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)} color="inherit">{tc('cancel')}</Button>
          <Button onClick={deleteConfirmed} color="error" variant="contained" aria-label="Delete">{tc('delete')}</Button>
        </DialogActions>
      </Dialog>
      {/* Invalidate Dialog — irreversible action */}
      <Dialog
        open={openInvalidateDialog}
        onClose={() => setOpenInvalidateDialog(false)}
        aria-labelledby="invalidate-dialog-title"
      >
        <DialogTitle id="invalidate-dialog-title">Invalidate {entityLabel}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This action is <strong>irreversible</strong>. The {entityLabel.toLowerCase()}&apos;s personal data will be permanently anonymized. Are you sure?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenInvalidateDialog(false)} color="inherit">{tc('cancel')}</Button>
          <Button onClick={invalidateConfirmed} color="warning" variant="contained" aria-label="Invalidate">Invalidate</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
