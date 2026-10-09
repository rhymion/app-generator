'use client';
import { useState, useTransition, useCallback, useRef } from 'react';
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
import BlockIcon from '@mui/icons-material/Block';
import type { ModelPermissions } from '@/lib/authz';
import type { PageOpts, PageResult } from '@/lib/_pagination';
import type { ActionFailure } from '@/lib/_errors';
import { errorMessageKey } from '@/lib/_errors';
import { AppAlert } from '@/components/ui';
import ListQueryPanel from './ListQueryPanel';
import { EMPTY_LIST_QUERY, toListQuery, type ListQuerySpec, type ListQueryState, type SortItem } from '@/lib/_list_query';

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
  /** MUI GridColDef.type -- the real filter control for this column (a
   * value dropdown for enum, a date/datetime picker, a checkbox for
   * boolean, a number box for number/decimal). Unset (plain text filter)
   * for string columns and for FK relation display columns
   * (app-generator#756). */
  type?: 'singleSelect' | 'boolean' | 'date' | 'dateTime' | 'number';
  /** Options for a 'singleSelect' column's filter dropdown -- built
   * server-side from the same i18n label source as the cell's own
   * displayed value, so the two can never drift apart. */
  valueOptions?: { value: string | number; label: string }[];
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
  removeAction?: (ids: string[]) => Promise<ActionFailure | void>;
  invalidateAction?: (id: string) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  primaryField?: keyof T;
  /** When true, edit and create links open in a new tab. Use in parent-embedded bridge grids. */
  openLinksInNewTab?: boolean;
  /** When false, the "+" create button is hidden even if the user has create permission.
   * Used for bridge-child entities, which cannot be created standalone (only via a parent),
   * and for entities whose x-generate.new is false (no /new page exists to link to). */
  allowCreate?: boolean;
  /** When false, the edit icon is hidden even if the user has update permission.
   * Used for entities whose x-generate.edit is false (no /edit page exists to link to) --
   * without this, a role granted `update` (e.g. via grant-all-permissions.ts) sees an
   * edit icon that 404s when clicked. */
  allowEdit?: boolean;
  /**
   * What the list's multi-column sort / multi-field filter / search panel offers (server mode
   * only). When set, the panel is shown above the grid and owns the sort: a click on a column
   * header replaces the panel's sort with that one column. Filters from the panel and from the
   * grid's own filter menu apply together; on a field both filter, the grid's filter wins.
   * Unset, the grid sorts and filters one column at a time, as before.
   */
  listQuery?: ListQuerySpec;
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
  allowEdit = true,
  listQuery,
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
  const [query, setQuery] = useState<ListQueryState>(EMPTY_LIST_QUERY);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({ items: [] });
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openInvalidateDialog, setOpenInvalidateDialog] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingInvalidateId, setPendingInvalidateId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const apiRef = useGridApiRef();
  const tc = useTranslations('Common');
  const tf = useTranslations('Fields');
  const terr = useTranslations('Errors');

  // The latest reload; an answer to an earlier one (typing, a filter and a sort change in quick
  // succession) must not overwrite the rows of a later request.
  const latestReload = useRef(0);
  const reload = useCallback((p: GridPaginationModel, s: GridSortModel, f: GridFilterModel, q: ListQueryState) => {
    if (!fetchPage) return;
    const panelQuery = listQuery ? toListQuery(q, listQuery) : null;
    const thisReload = ++latestReload.current;
    startTransition(async () => {
      const result = await fetchPage({
        page: p.page,
        pageSize: p.pageSize,
        sort: panelQuery
          ? panelQuery.sort
          : s.map((x): SortItem => ({ field: x.field, dir: x.sort === 'desc' ? 'desc' : 'asc' })),
        filter: {
          ...(panelQuery?.filter ?? {}),
          ...Object.fromEntries(
            f.items
              .filter(i => i.value !== undefined && i.value !== null && i.value !== '')
              .map(i => [i.field, { operator: i.operator, value: i.value }]),
          ),
        },
      });
      if (thisReload !== latestReload.current) return;
      setItems(result.rows as T[]);
      setRowCount(result.total);
    });
  }, [fetchPage, listQuery]);

  const onQueryChange = (next: ListQueryState) => {
    setQuery(next);
    // A new search, sort or filter starts from the first page.
    const first = { ...paginationModel, page: 0 };
    setPaginationModel(first);
    reload(first, sortModel, filterModel, next);
  };

  const deleteSelected = () => {
    // Capture IDs now — before the Dialog opens and its focus trap causes
    // MUI DataGrid to fire onRowSelectionModelChange with an empty set.
    setPendingDeleteIds(Array.from(selectedRowIds.ids) as string[]);
    setOpenDeleteDialog(true);
  };

  const deleteConfirmed = () => {
    if (pendingDeleteIds.length > 0 && removeAction) {
      const idsToDelete = pendingDeleteIds;
      const removedItems = items.filter(item => idsToDelete.includes((item as { id: string }).id));
      setDeleteError(null);
      setItems(prev => prev.filter(item => !idsToDelete.includes((item as { id: string }).id)));
      if (serverMode) setRowCount(prev => Math.max(0, prev - idsToDelete.length));
      startTransition(async () => {
        const result = await removeAction(idsToDelete);
        if (result && !result.ok) {
          // Delete failed server-side (e.g. permission denied on some of
          // the selected rows) — roll back the optimistic removal instead
          // of leaving the grid showing rows that were never deleted.
          setItems(prev => [...prev, ...removedItems]);
          if (serverMode) setRowCount(prev => prev + idsToDelete.length);
          setDeleteError(terr(errorMessageKey(result.errorCode)));
        }
      });
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
    // MUI's own type-specific default valueFormatter is unsafe for the raw
    // value shape our cells actually carry: 'date'/'dateTime' throws unless
    // the resolved value is a real Date instance (ours is already a
    // pre-formatted display string -- ISSUE#756), and 'singleSelect' tries
    // to map the resolved value back to one of `valueOptions`' raw values
    // to find its label -- but our resolved value IS already the label
    // (formatting_entries replaces the row's raw enum value with its
    // translated label server-side, before this component ever sees it),
    // so that lookup always misses and silently renders blank text. An
    // identity valueFormatter sidesteps both: it keeps exactly what our own
    // valueGetter/pre-formatting already computed, safe and unchanged.
    const needsIdentityValueFormatter = fieldConfig.type === 'singleSelect' || fieldConfig.type === 'date' || fieldConfig.type === 'dateTime';
    const identityValueFormatter = (value: unknown) => (value ?? '') as string;

    // Special handling for primary field to include link to view page
    if (fieldConfig.field === primaryField) {
      return {
        field: fieldConfig.field as string,
        headerName: fieldConfig.headerName,
        width: fieldConfig.width || 150,
        type: fieldConfig.type,
        valueOptions: fieldConfig.valueOptions,
        ...(needsIdentityValueFormatter ? { valueFormatter: identityValueFormatter } : {}),
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
        type: fieldConfig.type,
        valueOptions: fieldConfig.valueOptions,
        ...(needsIdentityValueFormatter ? { valueFormatter: identityValueFormatter } : {}),
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
      type: fieldConfig.type,
      valueOptions: fieldConfig.valueOptions,
      ...(needsIdentityValueFormatter ? { valueFormatter: identityValueFormatter } : {}),
      valueGetter: (value, row) => {
        const fieldValue = row[fieldConfig.field];
        // 'boolean' must pass the raw boolean through unchanged -- MUI's
        // boolean cell icon reads params.value directly (not
        // formattedValue), so stringifying it here (as the generic
        // fallback below does) would make every row's icon render "true"
        // (a non-empty string is truthy) regardless of the real value.
        if (fieldConfig.type === 'boolean') return fieldValue as boolean | null | undefined;
        if (fieldValue === null || fieldValue === undefined) return '';
        if (fieldConfig.format) return formatLabelValue(fieldValue, fieldConfig.format, fieldConfig.showSeconds);
        if (fieldConfig.enumLabels && typeof fieldValue === 'number') return fieldConfig.enumLabels[fieldValue] ?? String(fieldValue);
        if (typeof fieldValue === 'object' && 'name' in (fieldValue as object)) return (fieldValue as unknown as { name: string }).name;
        return String(fieldValue);
      },
    };
  });

  const columns: GridColDef<T>[] = dataColumns;
  if ((permissions.update && allowEdit) || invalidateAction) columns.push(
    {
      field: 'actions',
      headerName: tf('actions'),
      width: invalidateAction ? 120 : 80,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        return (
          <span style={{ display: 'flex', gap: 4 }}>
            {permissions.update && allowEdit && (
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
                  <BlockIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </span>
        );
      },
    },
  );

  // The grid shows one sort column. With the panel, that is the first of the panel's sort columns
  // the grid has a column for (the grid drops a sort model entry it cannot match to a column).
  const gridColumnFields = new Set(columns.map(column => column.field));
  const gridSortModel: GridSortModel = listQuery
    ? query.sort.filter(item => gridColumnFields.has(item.field)).slice(0, 1).map(item => ({ field: item.field, sort: item.dir }))
    : sortModel;

  return (
    <div>
      {deleteError && (
        <AppAlert severity="error" mb={2}>{deleteError}</AppAlert>
      )}
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
      {listQuery && serverMode && (
        <ListQueryPanel spec={listQuery} value={query} onChange={onQueryChange} />
      )}
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
                sortModel: gridSortModel,
                onSortModelChange: (m: GridSortModel) => {
                  if (listQuery) {
                    // The grid reports the model it was just given (the panel's primary sort) back
                    // as a change; only a header click, which differs from it, is the user's.
                    if (m.length === gridSortModel.length && m.every((x, i) => x.field === gridSortModel[i].field && x.sort === gridSortModel[i].sort)) return;
                    // A header click sorts by that one column and replaces the panel's sort.
                    const next = { ...query, sort: m.map((x): SortItem => ({ field: x.field, dir: x.sort === 'desc' ? 'desc' : 'asc' })) };
                    setQuery(next);
                    reload(paginationModel, m, filterModel, next);
                    return;
                  }
                  setSortModel(m);
                  reload(paginationModel, m, filterModel, query);
                },
                filterModel,
                onFilterModelChange: (m: GridFilterModel) => {
                  setFilterModel(m);
                  reload(paginationModel, sortModel, m, query);
                },
              }
            : {})}
          paginationModel={paginationModel}
          onPaginationModelChange={(m) => {
            setPaginationModel(m);
            if (serverMode) reload(m, sortModel, filterModel, query);
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
