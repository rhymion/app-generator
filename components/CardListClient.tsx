'use client';

import { useState, useTransition } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { ModelPermissions } from '@/lib/authz';

interface BaseEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface DisplayFieldConfig<T> {
  field: keyof T;
  headerName: string;
}

interface CardListClientProps<T extends BaseEntity> {
  src: T[];
  basePath: string;
  removeAction?: (formDataOrIds: FormData | string[]) => Promise<void>;
  entityLabel?: string;
  /** Fields to display. Defaults to name + description. */
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  /** Which field to display prominently as the card title. Defaults to 'name'. */
  primaryField?: keyof T;
}

function formatValue<T>(item: T, field: keyof T): string {
  const value = item[field];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value !== null && 'name' in value) return (value as { name: string }).name;
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function CardListClient<T extends BaseEntity>({
  src,
  basePath,
  removeAction,
  entityLabel = 'Item',
  displayFields,
  permissions = { create: true, read: true, update: true, delete: true },
  primaryField = 'name' as keyof T,
}: CardListClientProps<T>) {
  const [items] = useState(src);
  const [isPending, startTransition] = useTransition();
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const defaultDisplayFields: DisplayFieldConfig<T>[] = displayFields ?? [
    { field: 'name' as keyof T, headerName: 'Name' },
    { field: 'description' as keyof T, headerName: 'Description' },
  ];

  const secondaryFields = defaultDisplayFields.filter((f) => f.field !== primaryField);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteConfirm = () => {
    if (selectedIds.size > 0 && removeAction) {
      const ids = Array.from(selectedIds);
      startTransition(async () => {
        await removeAction(ids);
      });
      setSelectedIds(new Set());
    }
    setOpenDeleteDialog(false);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {permissions.create && (
          <Link href={`${basePath}/new`}>
            <Button variant="contained">Create New {entityLabel}</Button>
          </Link>
        )}
        {permissions.delete && (
          <Button
            variant="contained"
            color="error"
            onClick={() => setOpenDeleteDialog(true)}
            disabled={selectedIds.size === 0}
          >
            Delete Selected
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.length === 0 ? (
          <Typography color="text.secondary">No items found.</Typography>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const primaryValue = formatValue(item, primaryField);

            return (
              <Card
                key={item.id}
                variant="outlined"
                sx={{ opacity: isPending ? 0.7 : 1, transition: 'opacity 0.2s' }}
              >
                <CardContent sx={{ pb: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Link href={`${basePath}/view/${item.id}`} underline="hover" color="inherit">
                      <Typography variant="h6" component="div" sx={{ lineHeight: 1.3 }}>
                        {primaryValue || item.id}
                      </Typography>
                    </Link>
                    {permissions.delete && (
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleSelection(item.id)}
                        size="small"
                        sx={{ mt: -0.5, mr: -1 }}
                        inputProps={{ 'aria-label': `Select ${primaryValue || item.id}` }}
                      />
                    )}
                  </Box>
                  {secondaryFields.map((fieldConfig) => {
                    const value = formatValue(item, fieldConfig.field);
                    if (!value) return null;
                    return (
                      <Box key={String(fieldConfig.field)} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" component="span">
                          {fieldConfig.headerName}:{' '}
                        </Typography>
                        <Typography variant="body2" component="span">
                          {value}
                        </Typography>
                      </Box>
                    );
                  })}
                </CardContent>
                {permissions.update && (
                  <CardActions sx={{ justifyContent: 'flex-end' }}>
                    <Link href={`${basePath}/edit/${item.id}`}>
                      <Button size="small" variant="contained">
                        Edit
                      </Button>
                    </Link>
                  </CardActions>
                )}
              </Card>
            );
          })
        )}
      </Box>

      <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
        <DialogTitle>Delete {entityLabel}(s)?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the selected {entityLabel.toLowerCase()}(s)? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
