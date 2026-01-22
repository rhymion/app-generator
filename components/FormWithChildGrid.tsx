'use client';

import { ReactNode, useState } from 'react';
import { GridColDef, GridRowsProp } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';

interface FormWithChildGridProps {
  title: string;
  isEdit: boolean;
  formFields: ReactNode;
  onSubmit: (formData: FormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onBack: () => void;
  deleteEntityLabel?: string;
  submitButtonLabel?: string;
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
}: FormWithChildGridProps) {
  const [openDeleteEntityDialog, setOpenDeleteEntityDialog] = useState(false);
  const [openBackDialog, setOpenBackDialog] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    await onSubmit(formData);
  };

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
        <Button variant="outlined" onClick={() => setOpenBackDialog(true)}>
          Back to List
        </Button>
      </div>
      <form action={handleSubmit}>
        {formFields}
        <Button type="submit" variant="contained" sx={{ mt: 2, mr: 2 }}>
          {submitButtonLabel}
        </Button>
        {isEdit && onDelete && (
          <Button
            onClick={() => setOpenDeleteEntityDialog(true)}
            variant="contained"
            color="error"
            sx={{ mt: 2 }}
          >
            Delete {deleteEntityLabel}
          </Button>
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
            <Button onClick={() => setOpenDeleteEntityDialog(false)} color="inherit">
              Cancel
            </Button>
            <Button onClick={handleDeleteConfirmed} color="error" variant="contained">
              Delete
            </Button>
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
          <Button onClick={() => setOpenBackDialog(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleBackConfirmed} color="primary" variant="contained">
            Go Back
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
