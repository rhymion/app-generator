'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
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
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
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
  uriKind?: 'image' | 'link';
}

interface CardListClientProps<T extends BaseEntity> {
  /** Client-mode rows. Required when initialRows is not provided. */
  src?: T[];
  /** Server-mode initial page rows. Currently rendered without a load-more control. */
  initialRows?: T[];
  initialRowCount?: number;
  initialPage?: number;
  initialPageSize?: number;
  fetchPage?: (opts: PageOpts) => Promise<PageResult<T>>;
  basePath: string;
  removeAction?: (ids: string[]) => Promise<void>;
  entityLabel?: string;
  /** Fields to display. Defaults to name + description. */
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  /** Which field to display prominently as the card title. Defaults to 'name'. */
  primaryField?: keyof T;
}

function formatValue<T>(item: T, field: keyof T, format?: 'date-time' | 'date' | 'time'): string {
  const value = item[field];
  if (value === null || value === undefined) return '';
  if (format === 'date-time') return dayjs(value as string).format('YYYY-MM-DD HH:mm');
  if (format === 'date') return dayjs(new Date(value as string).toISOString().slice(0, 10) as string).format('YYYY-MM-DD');
  if (format === 'time') return dayjs(value as string).format('HH:mm');;
  if (typeof value === 'object' && value !== null && 'name' in value) return (value as { name: string }).name;
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD HH:mm');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function CardListClient<T extends BaseEntity>({
  src,
  initialRows,
  basePath,
  removeAction,
  entityLabel = 'Item',
  displayFields,
  permissions = { create: true, read: true, update: true, delete: true },
  primaryField = 'name' as keyof T,
}: CardListClientProps<T>) {
  const [items] = useState<T[]>(initialRows ?? src ?? []);
  const [isPending, startTransition] = useTransition();
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tf = useTranslations('Fields');
  const defaultDisplayFields: DisplayFieldConfig<T>[] = displayFields ?? [
    { field: 'name' as keyof T, headerName: tf('name') },
    { field: 'description' as keyof T, headerName: tf('description') },
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
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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
                color="error"
                onClick={() => setOpenDeleteDialog(true)}
                aria-label="Delete Selected"
                disabled={selectedIds.size === 0}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.length === 0 ? (
          <Typography color="text.secondary">No items found.</Typography>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const primaryFieldConfig = defaultDisplayFields.find(f => f.field === primaryField);
            const primaryValue = formatValue(item, primaryField, primaryFieldConfig?.format);

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
                        slotProps={{ input: { 'aria-label': `Select ${primaryValue || item.id}` } }}
                      />
                    )}
                  </Box>
                  {secondaryFields.map((fieldConfig) => {
                    if (fieldConfig.uriKind === 'link') {
                      const href = item[fieldConfig.field] as string | null | undefined;
                      if (!href) return null;
                      return (
                        <Box key={String(fieldConfig.field)} sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary" component="span">
                            {fieldConfig.headerName}:{' '}
                          </Typography>
                          <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.875rem', wordBreak: 'break-all' }}>
                            {href}
                          </a>
                        </Box>
                      );
                    }
                    const value = formatValue(item, fieldConfig.field, fieldConfig.format);
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
                      <Tooltip title="Edit">
                        <IconButton size="small" color="primary" aria-label="Edit">
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
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
          <Button onClick={() => setOpenDeleteDialog(false)} color="inherit">Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" aria-label="Delete">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
