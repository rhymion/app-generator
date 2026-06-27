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
import BlockIcon from '@mui/icons-material/Block';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslations } from 'next-intl';

interface FormWithChildGridProps {
  title: string;
  isEdit: boolean;
  formFields: ReactNode;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onInvalidate?: () => Promise<void>;
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
  onInvalidate,
  onBack,
  deleteEntityLabel = 'Item',
  submitButtonLabel = 'Save',
  error,
}: FormWithChildGridProps) {
  const [openDeleteEntityDialog, setOpenDeleteEntityDialog] = useState(false);
  const [openInvalidateDialog, setOpenInvalidateDialog] = useState(false);
  const [openBackDialog, setOpenBackDialog] = useState(false);
  const tc = useTranslations('Common');
  const tf = useTranslations('Fields');

  const handleDeleteConfirmed = async () => {
    if (onDelete) {
      await onDelete();
    }
    setOpenDeleteEntityDialog(false);
  };

  const handleInvalidateConfirmed = async () => {
    if (onInvalidate) {
      await onInvalidate();
    }
    setOpenInvalidateDialog(false);
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
        {isEdit && onInvalidate && (
          <Tooltip title={`Invalidate ${deleteEntityLabel}`}>
            <IconButton
              onClick={() => setOpenInvalidateDialog(true)}
              color="warning"
              aria-label={`Invalidate ${deleteEntityLabel}`}
              sx={{ mt: 2 }}
            >
              <BlockIcon />
            </IconButton>
          </Tooltip>
        )}
      </form>

      {/* Invalidate Entity Dialog */}
      {isEdit && onInvalidate && (
        <Dialog
          open={openInvalidateDialog}
          onClose={() => setOpenInvalidateDialog(false)}
          aria-labelledby="invalidate-entity-dialog-title"
        >
          <DialogTitle id="invalidate-entity-dialog-title">
            Invalidate this {deleteEntityLabel}?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              This action is irreversible. All personal data will be anonymized.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenInvalidateDialog(false)} color="inherit">{tc('cancel')}</Button>
            <Button onClick={handleInvalidateConfirmed} color="warning" variant="contained" aria-label="Invalidate">Invalidate</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Delete Entity Dialog */}
      {isEdit && onDelete && (
        <Dialog
          open={openDeleteEntityDialog}
          onClose={() => setOpenDeleteEntityDialog(false)}
          aria-labelledby="delete-entity-dialog-title"
        >
          <DialogTitle id="delete-entity-dialog-title">
            {tc('deleteDialogTitle', { entity: deleteEntityLabel })}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {tc('deleteMessage', { entity: deleteEntityLabel.toLowerCase() })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDeleteEntityDialog(false)} color="inherit">{tc('cancel')}</Button>
            <Button onClick={handleDeleteConfirmed} color="error" variant="contained" aria-label="Delete">{tc('delete')}</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Back to List Dialog */}
      <Dialog
        open={openBackDialog}
        onClose={() => setOpenBackDialog(false)}
        aria-labelledby="back-dialog-title"
      >
        <DialogTitle id="back-dialog-title">{tc('backDialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {tc('backMessage')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenBackDialog(false)} color="inherit">{tc('cancel')}</Button>
          <Button onClick={handleBackConfirmed} color="primary" variant="contained">{tc('goBack')}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
