'use client';

import { useState, forwardRef, useImperativeHandle, useMemo, useEffect, useRef } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';

import type { ItemType, EditableListWrapperItem, AutocompleteOption } from './EditableListWrapper';
import type { EntitySearchAction } from './EntityAutocomplete';

const EMPTY_ITEMS: EditableListWrapperItem[] = [];

interface OrderedEditableListWrapperProps {
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
  // For autocomplete with internal filtering
  allAutocompleteOptions?: AutocompleteOption[];
  excludeOptionIds?: (string | number)[];
  // For autocomplete with server-side search.
  searchOptions?: EntitySearchAction;
  initialAutocompleteOptions?: AutocompleteOption[];
  // For file type
  acceptedFileTypes?: string;
  maxFileSize?: number;
  uploadEndpoint?: string;
  fileVariant?: 'file' | 'image';
  // Custom rendering
  renderItem?: (item: EditableListWrapperItem) => React.ReactNode;
  // Validation
  validateItem?: (value: unknown) => string | null;
  // Change callback
  /** @deprecated No longer needed when using allAutocompleteOptions */
  onItemsChange?: (items: EditableListWrapperItem[]) => void;
}

interface OrderedEditableListWrapperHandle {
  getItems: () => EditableListWrapperItem[];
}

const OrderedEditableListWrapper = forwardRef<OrderedEditableListWrapperHandle, OrderedEditableListWrapperProps>(
  ({
    initialItems = EMPTY_ITEMS,
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
    maxFileSize = 10 * 1024 * 1024,
    uploadEndpoint = '/api/upload',
    fileVariant = 'file',
    renderItem,
    validateItem,
    onItemsChange,
  }, ref) => {
    const [items, setItems] = useState<EditableListWrapperItem[]>([]);
    const [openAddDialog, setOpenAddDialog] = useState(false);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableListWrapperItem | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [selectedAutocomplete, setSelectedAutocomplete] = useState<AutocompleteOption | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    // Initialize: sort by existing order field, then assign sequential values
    useEffect(() => {
      const sorted = [...initialItems].sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : 0;
        const orderB = typeof b.order === 'number' ? b.order : 0;
        return orderA - orderB;
      });
      const withOrder = sorted.map((item, index) => ({
        ...item,
        order: index + 1,
      }));
      setItems(withOrder);
    }, [initialItems]);

    // Reassign sequential order values
    const updateItemsOrder = (updatedItems: EditableListWrapperItem[]) => {
      const withOrder = updatedItems.map((item, index) => ({
        ...item,
        order: index + 1,
      }));
      setItems(withOrder);
      onItemsChange?.(withOrder);
    };

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
            setSearchResults(results.map((r) => ({ id: r.id, label: r.label })));
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
      setSelectedAutocomplete(null);
      setSelectedFile(null);
      setError(null);
      setSearchQuery('');
      setSearchResults(initialAutocompleteOptions ?? []);
      setOpenAddDialog(true);
    };

    const handleOpenEditDialog = (item: EditableListWrapperItem) => {
      if (itemType !== 'text') return;
      setEditingItem(item);
      setInputValue(item.value || '');
      setError(null);
      setOpenEditDialog(true);
    };

    const handleCloseAddDialog = () => {
      if (uploading) return;
      setOpenAddDialog(false);
      setInputValue('');
      setSelectedAutocomplete(null);
      setSelectedFile(null);
      setError(null);
    };

    const handleCloseEditDialog = () => {
      setOpenEditDialog(false);
      setEditingItem(null);
      setInputValue('');
      setError(null);
    };

    const handleAdd = async () => {
      let value: string | number;
      let label: string = '';

      switch (itemType) {
        case 'text':
          value = inputValue.trim();
          if (!value) {
            setError('Value cannot be empty');
            return;
          }
          label = value;
          break;
        case 'autocomplete':
          if (!selectedAutocomplete) {
            setError('Please select an option');
            return;
          }
          value = selectedAutocomplete.id;
          label = selectedAutocomplete.label;
          break;
        case 'file':
          if (!selectedFile) {
            setError('Please select a file');
            return;
          }
          if (selectedFile.size > maxFileSize) {
            setError(`File size must be less than ${maxFileSize / 1024 / 1024}MB`);
            return;
          }
          setUploading(true);
          try {
            const uploadFormData = new FormData();
            uploadFormData.append('file', selectedFile);
            const response = await fetch(uploadEndpoint, {
              method: 'POST',
              body: uploadFormData,
            });
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Upload failed');
            }
            const data = await response.json();
            value = data.url;
            label = selectedFile.name;
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            setUploading(false);
            return;
          } finally {
            setUploading(false);
          }
          break;
      }

      if (validateItem) {
        const validationError = validateItem(value);
        if (validationError) {
          setError(validationError);
          return;
        }
      }

      const newItem: EditableListWrapperItem = {
        id: `temp-${Date.now()}-${Math.random()}`,
        value,
        label,
        type: itemType,
      };

      updateItemsOrder([...items, newItem]);
      handleCloseAddDialog();
    };

    const handleEdit = () => {
      if (!editingItem) return;

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

      const updatedItems = items.map(item =>
        item.id === editingItem.id
          ? { ...item, value, label: value }
          : item
      );
      setItems(updatedItems);
      handleCloseEditDialog();
    };

    const handleDelete = (id: string | number) => {
      updateItemsOrder(items.filter(item => item.id !== id));
    };

    const handleMoveUp = (index: number) => {
      if (index <= 0) return;
      const newItems = [...items];
      [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
      updateItemsOrder(newItems);
    };

    const handleMoveDown = (index: number) => {
      if (index >= items.length - 1) return;
      const newItems = [...items];
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
      updateItemsOrder(newItems);
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        setSelectedFile(file);
        setError(null);
      }
    };

    const isUrlValue = (v: unknown): v is string =>
      typeof v === 'string' && (v.startsWith('/') || v.startsWith('http'));

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
          primary={item.label || item.value}
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

        <Paper sx={{ maxHeight: 400, overflow: 'auto' }}>
          <List>
            {items.length === 0 ? (
              <ListItem>
                <ListItemText primary="No items yet" />
              </ListItem>
            ) : (
              items.map((item, index) => (
                <ListItem
                  key={item.id}
                  secondaryAction={
                    <Box>
                      <IconButton
                        edge="end"
                        aria-label="move up"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        size="small"
                      >
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        edge="end"
                        aria-label="move down"
                        onClick={() => handleMoveDown(index)}
                        disabled={index === items.length - 1}
                        size="small"
                      >
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                      {itemType === 'text' && (
                        <IconButton
                          edge="end"
                          aria-label="edit"
                          onClick={() => handleOpenEditDialog(item)}
                          size="small"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        edge="end"
                        aria-label="delete"
                        onClick={() => handleDelete(item.id)}
                        size="small"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 28, mr: 1, flexShrink: 0 }}
                  >
                    {item.order}.
                  </Typography>
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
                      input: {
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {searchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                            {params.InputProps.endAdornment}
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
                <Tooltip title="Choose File">
                  <span>
                    <IconButton component="label" disabled={uploading} aria-label="Choose File">
                      <UploadFileIcon />
                      <input
                        type="file"
                        hidden
                        accept={acceptedFileTypes}
                        onChange={handleFileChange}
                      />
                    </IconButton>
                  </span>
                </Tooltip>
                {selectedFile && !uploading && (
                  <Box sx={{ mt: 1 }}>
                    <strong>Selected:</strong> {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                  </Box>
                )}
                {uploading && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={20} />
                    <span>Uploading...</span>
                  </Box>
                )}
                {error && (
                  <Box sx={{ mt: 1, color: 'error.main', fontSize: '0.875rem' }}>
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

OrderedEditableListWrapper.displayName = 'OrderedEditableListWrapper';

export default OrderedEditableListWrapper;
