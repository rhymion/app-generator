'use client';

import { useState, forwardRef, useImperativeHandle } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';

export type ItemType = 'text' | 'autocomplete' | 'file';

export interface EditableListWrapperItem {
  id: string | number;
  value: any;
  label?: string;
  [key: string]: any;
}

export interface AutocompleteOption {
  id: string | number;
  label: string;
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
  autocompleteOptions?: AutocompleteOption[];
  autocompleteLabel?: string;
  autocompletePlaceholder?: string;
  // For file type
  acceptedFileTypes?: string;
  maxFileSize?: number; // in bytes
  // Custom rendering
  renderItem?: (item: EditableListWrapperItem) => React.ReactNode;
  // Validation
  validateItem?: (value: any) => string | null; // returns error message or null
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
    acceptedFileTypes = '*',
    maxFileSize = 10 * 1024 * 1024, // 10MB default
    renderItem,
    validateItem,
  }, ref) => {
    const [items, setItems] = useState<EditableListWrapperItem[]>(initialItems);
    const [openAddDialog, setOpenAddDialog] = useState(false);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableListWrapperItem | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [selectedAutocomplete, setSelectedAutocomplete] = useState<AutocompleteOption | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      getItems: () => items,
    }), [items]);

    const handleOpenAddDialog = () => {
      setInputValue('');
      setSelectedAutocomplete(null);
      setSelectedFile(null);
      setError(null);
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

    const handleAdd = () => {
      let value: any;
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
          value = selectedFile;
          label = selectedFile.name;
          break;
      }

      // Custom validation
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

      setItems([...items, newItem]);
      handleCloseAddDialog();
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
      setItems(updatedItems);
      handleCloseEditDialog();
    };

    const handleDelete = (id: string | number) => {
      setItems(items.filter(item => item.id !== id));
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        setSelectedFile(file);
        setError(null);
      }
    };

    const defaultRenderItem = (item: EditableListWrapperItem) => {
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
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenAddDialog}
          >
            {addButtonLabel}
          </Button>
        </Box>

        <Paper sx={{ maxHeight: 400, overflow: 'auto' }}>
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
                options={autocompleteOptions}
                getOptionLabel={(option) => option.label}
                value={selectedAutocomplete}
                onChange={(_, newValue) => {
                  setSelectedAutocomplete(newValue);
                  setError(null);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={autocompleteLabel}
                    placeholder={autocompletePlaceholder}
                    margin="dense"
                    error={!!error}
                    helperText={error}
                  />
                )}
              />
            )}

            {itemType === 'file' && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                >
                  Choose File
                  <input
                    type="file"
                    hidden
                    accept={acceptedFileTypes}
                    onChange={handleFileChange}
                  />
                </Button>
                {selectedFile && (
                  <Box sx={{ mt: 1 }}>
                    <strong>Selected:</strong> {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
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
            <Button onClick={handleCloseAddDialog}>Cancel</Button>
            <Button onClick={handleAdd} variant="contained">Add</Button>
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
            <Button onClick={handleCloseEditDialog}>Cancel</Button>
            <Button onClick={handleEdit} variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
      </div>
    );
  }
);

EditableListWrapper.displayName = 'EditableListWrapper';

export default EditableListWrapper;
