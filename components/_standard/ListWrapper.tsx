'use client';

import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';

export type ItemType = 'text' | 'autocomplete' | 'file';

export interface ListWrapperItem {
  id: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  label?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface ListWrapperProps {
  items?: ListWrapperItem[];
  itemType: ItemType;
  title?: string;
  showTitle?: boolean;
  fileVariant?: 'file' | 'image';
  // Custom rendering
  renderItem?: (item: ListWrapperItem) => React.ReactNode;
}

function ListWrapper(
{
  items = [],
  itemType,
  title = 'Items',
  showTitle = true,
  fileVariant = 'file',
  renderItem,
}: ListWrapperProps)
{

  const isUrlValue = (v: unknown): v is string =>
    typeof v === 'string' && (v.startsWith('/') || v.startsWith('http'));

  const defaultRenderItem = (item: ListWrapperItem) => {
    if (itemType === 'file' && isUrlValue(item.value)) {
      if (fileVariant === 'image') {
        return (
          <ListItemText
            primary={
              <Link href={item.value} target="_blank" rel="noopener noreferrer">
                {item.label || 'Image'}
              </Link>
            }
            secondary={
              // item.value is an arbitrary uploaded-file URL of unknown origin/dimensions;
              // next/image needs a configured remote pattern and fixed dimensions, out of scope here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.value} alt={item.label || ''} style={{ maxWidth: 100, maxHeight: 100, objectFit: 'contain', marginTop: 4 }} />
            }
          />
        );
      }
      return (
        <ListItemText
          primary={
            <Link href={item.value} target="_blank" rel="noopener noreferrer" download>
              {item.label || item.value}
            </Link>
          }
        />
      );
    }
    return (
      <ListItemText
        primary={item.label || item.value}
        secondary={itemType === 'file' ? `File: ${item.value?.name || 'N/A'}` : undefined}
      />
    );
  };

  return (
    <div>
      {showTitle && <h2>{title}</h2>}
      <Paper sx={{ mb: 2, maxHeight: 400, overflow: 'auto' }}>
        <List>
          {items.length === 0 ? (
            <ListItem>
              <ListItemText primary="No items yet" />
            </ListItem>
          ) : (
            items.map((item) => (
              <ListItem
                key={item.id}
              >
                {renderItem ? renderItem(item) : defaultRenderItem(item)}
              </ListItem>
            ))
          )}
        </List>
      </Paper>
    </div>
  );
};

export default ListWrapper;
