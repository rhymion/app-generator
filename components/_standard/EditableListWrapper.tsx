'use client';

import { useState, forwardRef, useImperativeHandle, useMemo, useEffect, useRef } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import { isSafeUrl } from '@/lib/_safe_url';
import type { EntitySearchAction } from './EntityAutocomplete';
import { itemsFromOptions, mergeFiles, uploadFiles } from './editableListAdd';

export type ItemType = 'text' | 'autocomplete' | 'file';

export interface EditableListWrapperItem {
  id: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  label?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AutocompleteOption {
  id: string | number;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface EditableListWrapperProps {
  initialItems?: EditableListWrapperItem[];
  itemType: ItemType;
  addButtonLabel?: string;
  title?: string;
  showTitle?: boolean;
  // For text type
  textFieldLabel?: string;
  textFieldPlaceholder?: string;
  // For autocomplete type
  /** @deprecated Use allAutocompleteOptions instead for automatic filtering */
  autocompleteOptions?: AutocompleteOption[];
  autocompleteLabel?: string;
  autocompletePlaceholder?: string;
  // NEW: For autocomplete with internal filtering
  allAutocompleteOptions?: AutocompleteOption[];  // All available options (unfiltered)
  excludeOptionIds?: (string | number)[];          // IDs to exclude from options (e.g., [src.id])
  // For autocomplete with server-side search — preferred over allAutocompleteOptions for large tables.
  searchOptions?: EntitySearchAction;
  initialAutocompleteOptions?: AutocompleteOption[];
  // For file type
  acceptedFileTypes?: string;
  maxFileSize?: number; // in bytes
  uploadEndpoint?: string;
  fileVariant?: 'file' | 'image';
  // Custom rendering
  renderItem?: (item: EditableListWrapperItem) => React.ReactNode;
  // Validation
  validateItem?: (value: unknown) => string | null; // returns error message or null
  // Change callback
  /** @deprecated No longer needed when using allAutocompleteOptions */
  onItemsChange?: (items: EditableListWrapperItem[]) => void;
}

interface EditableListWrapperHandle {
  getItems: () => EditableListWrapperItem[];
}

const EditableListWrapper = forwardRef<EditableListWrapperHandle, EditableListWrapperProps>(
  ({
    initialItems = [],
    itemType,
    addButtonLabel = 'Add Item',
    title = 'Items',
    showTitle = true,
    textFieldLabel = 'Value',
    textFieldPlaceholder = 'Enter value',
    autocompleteOptions = [],
    autocompleteLabel = 'Select',
    autocompletePlaceholder = 'Select an option',
    allAutocompleteOptions,
    excludeOptionIds,
    searchOptions,
    initialAutocompleteOptions,
    acceptedFileTypes = '*',
    maxFileSize = 10 * 1024 * 1024, // 10MB default
    uploadEndpoint = '/api/upload',
    fileVariant = 'file',
    renderItem,
    validateItem,
    onItemsChange,
  }, ref) => {
    const [items, setItems] = useState<EditableListWrapperItem[]>(initialItems);
    const [openAddDialog, setOpenAddDialog] = useState(false);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableListWrapperItem | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [selectedAutocomplete, setSelectedAutocomplete] = useState<AutocompleteOption[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<AutocompleteOption[]>(
      initialAutocompleteOptions ?? []
    );
    const [searchLoading, setSearchLoading] = useState(false);
    const searchSeqRef = useRef(0);

    const assignedIdSet = useMemo(() => {
      return new Set(
        items
          .map((item) => item.originalId ?? item.value)
          .filter((id): id is string | number =>
            typeof id === 'string' || typeof id === 'number'
          )
      );
    }, [items]);

    const excludeSet = useMemo(() => new Set(excludeOptionIds ?? []), [excludeOptionIds]);

    // Internal filtering for autocomplete options
    const availableOptions = useMemo(() => {
      const filterAssigned = (opts: AutocompleteOption[]) =>
        opts.filter((o) => !assignedIdSet.has(o.id) && !excludeSet.has(o.id));

      if (searchOptions) {
        return filterAssigned(searchResults);
      }
      if (allAutocompleteOptions) {
        return filterAssigned(allAutocompleteOptions);
      }
      return autocompleteOptions;
    }, [searchOptions, searchResults, allAutocompleteOptions, autocompleteOptions, assignedIdSet, excludeSet]);

    useEffect(() => {
      if (!searchOptions || !openAddDialog) return;
      const trimmed = searchQuery.trim();
      if (trimmed === '') {
        setSearchResults(initialAutocompleteOptions ?? []);
        return;
      }
      const mySeq = ++searchSeqRef.current;
      const handle = setTimeout(async () => {
        setSearchLoading(true);
        try {
          const results = await searchOptions(trimmed, []);
          if (mySeq === searchSeqRef.current) {
            setSearchResults(
              results.map((r) => ({ id: r.id, label: r.label }))
            );
          }
        } finally {
          if (mySeq === searchSeqRef.current) setSearchLoading(false);
        }
      }, 250);
      return () => clearTimeout(handle);
    }, [searchQuery, searchOptions, openAddDialog, initialAutocompleteOptions]);

    useImperativeHandle(ref, () => ({
      getItems: () => items,
    }), [items]);

    const handleOpenAddDialog = () => {
      setInputValue('');
      setSelectedAutocomplete([]);
      setSelectedFiles([]);
      setError(null);
      setSearchQuery('');
      setSearchResults(initialAutocompleteOptions ?? []);
      setOpenAddDialog(true);
    };

    const handleOpenEditDialog = (item: EditableListWrapperItem) => {
      if (itemType !== 'text') return; // Only text items are editable
      setEditingItem(item);
      setInputValue(item.value || '');
      setError(null);
      setOpenEditDialog(true);
    };

    const handleCloseAddDialog = () => {
      if (uploading) return;
      setOpenAddDialog(false);
      setInputValue('');
      setSelectedAutocomplete([]);
      setSelectedFiles([]);
      setError(null);
    };

    const handleCloseEditDialog = () => {
      setOpenEditDialog(false);
      setEditingItem(null);
      setInputValue('');
      setError(null);
    };

    const updateItems = (nextItems: EditableListWrapperItem[]) => {
      setItems(nextItems);
      onItemsChange?.(nextItems);
    };

    const handleAdd = async () => {
      if (itemType === 'text') {
        const value = inputValue.trim();
        if (!value) {
          setError('Value cannot be empty');
          return;
        }
        if (validateItem) {
          const validationError = validateItem(value);
          if (validationError) {
            setError(validationError);
            return;
          }
        }
        updateItems([...items, { id: `temp-${Date.now()}-${Math.random()}`, value, label: value, type: itemType }]);
        handleCloseAddDialog();
        return;
      }

      if (itemType === 'autocomplete') {
        // Several options can be picked in one dialog (#1411); all are added together.
        const { added, error: addError } = itemsFromOptions(selectedAutocomplete, validateItem);
        if (addError) {
          setError(addError);
          return;
        }
        updateItems([...items, ...added]);
        handleCloseAddDialog();
        return;
      }

      // file: several files can be chosen in one dialog (#1411). The ones that uploaded are added
      // even when others fail; the failed ones stay selected with their errors so they can be retried.
      setUploading(true);
      let result: Awaited<ReturnType<typeof uploadFiles>>;
      try {
        result = await uploadFiles(selectedFiles, { maxFileSize, uploadEndpoint, validateItem });
      } finally {
        setUploading(false);
      }
      if (result.added.length > 0) updateItems([...items, ...result.added]);
      if (result.error) {
        setSelectedFiles(result.failed);
        setError(result.error);
        return;
      }
      setOpenAddDialog(false);
      setSelectedFiles([]);
      setError(null);
    };

    const handleEdit = () => {
      if (!editingItem) return;

      const value = inputValue.trim();
      if (!value) {
        setError('Value cannot be empty');
        return;
      }

      // Custom validation
      if (validateItem) {
        const validationError = validateItem(value);
        if (validationError) {
          setError(validationError);
          return;
        }
      }

      const updatedItems = items.map(item =>
        item.id === editingItem.id
          ? { ...item, value, label: value }
          : item
      );
      updateItems(updatedItems);
      handleCloseEditDialog();
    };

    const handleDelete = (id: string | number) => {
      updateItems(items.filter(item => item.id !== id));
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files;
      if (chosen && chosen.length > 0) {
        setSelectedFiles((prev) => mergeFiles(prev, chosen));
        setError(null);
      }
      // Reset so the same file can be chosen again after it was removed from the selection.
      event.target.value = '';
    };

    const handleRemoveSelectedFile = (index: number) => {
      setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const isUrlValue = isSafeUrl;

    const defaultRenderItem = (item: EditableListWrapperItem) => {
      if (itemType === 'file' && isUrlValue(item.value)) {
        if (fileVariant === 'image') {
          return (
            <ListItemText
              primary={
                <Link href={item.value} target="_blank" rel="noopener noreferrer">
                  {item.label || item.value}
                </Link>
              }
              secondary={
                // item.value is an arbitrary uploaded-file URL of unknown origin/dimensions;
                // next/image needs a configured remote pattern and fixed dimensions, out of scope here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.value} alt={item.label || ''} style={{ maxWidth: 80, maxHeight: 80, objectFit: 'contain', marginTop: 4 }} />
              }
            />
          );
        }
        return (
          <ListItemText
            primary={
              <Link href={item.value} target="_blank" rel="noopener noreferrer">
                {item.label || item.value}
              </Link>
            }
          />
        );
      }
      return (
        <ListItemText
          primary={item.href ? <Link href={item.href}>{item.label || item.value}</Link> : (item.label || item.value)}
          secondary={item.type === 'file' ? `File: ${item.value?.name || 'N/A'}` : undefined}
        />
      );
    };

    return (
      <div>
        {showTitle && <h2>{title}</h2>}
        <Box sx={{ mb: 2 }}>
          <Tooltip title={addButtonLabel}>
            <IconButton color="primary" onClick={handleOpenAddDialog} aria-label={addButtonLabel}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Paper sx={{ mb: 2,maxHeight: 400, overflow: 'auto' }}>
          <List>
            {items.length === 0 ? (
              <ListItem>
                <ListItemText primary="No items yet" />
              </ListItem>
            ) : (
              items.map((item) => (
                <ListItem
                  key={item.id}
                  secondaryAction={
                    <Box>
                      {itemType === 'text' && (
                        <IconButton
                          edge="end"
                          aria-label="edit"
                          onClick={() => handleOpenEditDialog(item)}
                          sx={{ mr: 1 }}
                        >
                          <EditIcon />
                        </IconButton>
                      )}
                      <IconButton
                        edge="end"
                        aria-label="delete"
                        onClick={() => handleDelete(item.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  }
                >
                  {renderItem ? renderItem(item) : defaultRenderItem(item)}
                </ListItem>
              ))
            )}
          </List>
        </Paper>

        {/* Add Dialog */}
        <Dialog open={openAddDialog} onClose={handleCloseAddDialog} maxWidth="sm" fullWidth>
          <DialogTitle>Add {title}</DialogTitle>
          <DialogContent>
            {itemType === 'text' && (
              <TextField
                autoFocus
                margin="dense"
                label={textFieldLabel}
                placeholder={textFieldPlaceholder}
                fullWidth
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                error={!!error}
                helperText={error}
              />
            )}

            {itemType === 'autocomplete' && (
              <Autocomplete
                multiple
                filterSelectedOptions
                options={availableOptions}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(opt, val) => opt.id === val.id}
                value={selectedAutocomplete}
                onChange={(_, newValue) => {
                  setSelectedAutocomplete(newValue);
                  setError(null);
                }}
                onInputChange={(_, newInput, reason) => {
                  if (searchOptions && reason === 'input') setSearchQuery(newInput);
                  if (searchOptions && reason === 'clear') setSearchQuery('');
                }}
                filterOptions={searchOptions ? (x) => x : undefined}
                loading={searchLoading}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={autocompleteLabel}
                    placeholder={autocompletePlaceholder}
                    margin="dense"
                    error={!!error}
                    helperText={error}
                    slotProps={{
                      ...params.slotProps,
                      input: {
                        ...params.slotProps.input,
                        endAdornment: (
                          <>
                            {searchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                            {params.slotProps.input.endAdornment}
                          </>
                        ),
                      },
                    }}
                  />
                )}
              />
            )}

            {itemType === 'file' && (
              <Box sx={{ mt: 2 }}>
                <Tooltip title="Choose Files">
                  <span>
                    <IconButton component="label" disabled={uploading} aria-label="Choose Files">
                      <UploadFileIcon />
                      <input
                        type="file"
                        hidden
                        multiple
                        accept={acceptedFileTypes}
                        onChange={handleFileChange}
                      />
                    </IconButton>
                  </span>
                </Tooltip>
                {selectedFiles.length > 0 && !uploading && (
                  <Box sx={{ mt: 1 }}>
                    <strong>Selected:</strong>
                    <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
                      {selectedFiles.map((f, i) => (
                        <Box component="li" key={`${f.name}-${f.size}-${f.lastModified}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <span>{f.name} ({(f.size / 1024).toFixed(2)} KB)</span>
                          <IconButton size="small" aria-label={`Remove ${f.name}`} onClick={() => handleRemoveSelectedFile(i)}>
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
                {uploading && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={20} />
                    <span>Uploading...</span>
                  </Box>
                )}
                {error && (
                  <Box sx={{ mt: 1, color: 'error.main', fontSize: '0.875rem', whiteSpace: 'pre-line' }}>
                    {error}
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseAddDialog} disabled={uploading} color="inherit">Cancel</Button>
            <Button onClick={handleAdd} color="primary" variant="contained" disabled={uploading} startIcon={uploading ? <CircularProgress size={16} /> : undefined}>
              {uploading ? 'Uploading...' : addButtonLabel}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit Dialog (only for text items) */}
        <Dialog open={openEditDialog} onClose={handleCloseEditDialog} maxWidth="sm" fullWidth>
          <DialogTitle>Edit {title}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label={textFieldLabel}
              placeholder={textFieldPlaceholder}
              fullWidth
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              error={!!error}
              helperText={error}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseEditDialog} color="inherit">Cancel</Button>
            <Button onClick={handleEdit} color="primary" variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
      </div>
    );
  }
);

EditableListWrapper.displayName = 'EditableListWrapper';

export default EditableListWrapper;
