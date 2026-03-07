'use client';

import { ReactNode, useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface FormWithChildGridProps {
  title: string;
  isEdit: boolean;
  formFields: ReactNode;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onBack: () => void;
  deleteEntityLabel?: string;
  submitButtonLabel?: string;
  error?: string | null;
}

export default function FormWithChildGrid({
  title,
  isEdit,
  formFields,
  onSubmit,
  onDelete,
  onBack,
  deleteEntityLabel = 'Item',
  submitButtonLabel = 'Save',
  error,
}: FormWithChildGridProps) {
  const [openDeleteEntityDialog, setOpenDeleteEntityDialog] = useState(false);
  const [openBackDialog, setOpenBackDialog] = useState(false);

  const handleDeleteConfirmed = async () => {
    if (onDelete) {
      await onDelete();
    }
    setOpenDeleteEntityDialog(false);
  };

  const handleBackConfirmed = () => {
    setOpenBackDialog(false);
    onBack();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>{title}</h1>
        <Tooltip title="Back to List">
          <IconButton onClick={() => setOpenBackDialog(true)} aria-label="Back to List">
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
      </div>
      {error && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        {formFields}
        <Tooltip title={submitButtonLabel}>
          <IconButton type="submit" color="primary" aria-label={submitButtonLabel} sx={{ mt: 2, mr: 2 }}>
            <SaveIcon />
          </IconButton>
        </Tooltip>
        {isEdit && onDelete && (
          <Tooltip title={`Delete ${deleteEntityLabel}`}>
            <IconButton
              onClick={() => setOpenDeleteEntityDialog(true)}
              color="error"
              aria-label={`Delete ${deleteEntityLabel}`}
              sx={{ mt: 2 }}
            >
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        )}
      </form>

      {/* Delete Entity Dialog */}
      {isEdit && onDelete && (
        <Dialog
          open={openDeleteEntityDialog}
          onClose={() => setOpenDeleteEntityDialog(false)}
          aria-labelledby="delete-entity-dialog-title"
        >
          <DialogTitle id="delete-entity-dialog-title">
            Delete {deleteEntityLabel}?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete this {deleteEntityLabel.toLowerCase()}? This action cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDeleteEntityDialog(false)} color="inherit">Cancel</Button>
            <Button onClick={handleDeleteConfirmed} color="error" variant="contained" aria-label="Delete">Delete</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Back to List Dialog */}
      <Dialog
        open={openBackDialog}
        onClose={() => setOpenBackDialog(false)}
        aria-labelledby="back-dialog-title"
      >
        <DialogTitle id="back-dialog-title">Go Back?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any unsaved changes will be lost. Are you sure you want to go back to the list?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenBackDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={handleBackConfirmed} color="primary" variant="contained">Go Back</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
