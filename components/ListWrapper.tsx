'use client';

import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';

export type ItemType = 'text' | 'autocomplete' | 'file';

export interface ListWrapperItem {
  id: string | number;
  value: any;
  label?: string;
  [key: string]: any;
}

interface ListWrapperProps {
  items?: ListWrapperItem[];
  itemType: ItemType;
  title?: string;
  showTitle?: boolean;
  // Custom rendering
  renderItem?: (item: ListWrapperItem) => React.ReactNode;
}

interface ListWrapperHandle {
  getItems: () => ListWrapperItem[];
}

function ListWrapper(
{
  items = [],
  itemType,
  title = 'Items',
  showTitle = true,
  renderItem,
}: ListWrapperProps) 
{

  const defaultRenderItem = (item: ListWrapperItem) => {
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
