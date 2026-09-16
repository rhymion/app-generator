import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import React from 'react';

interface AppListProps {
  children: React.ReactNode;
  disablePadding?: boolean;
}

export function AppList({ children, disablePadding }: AppListProps) {
  return <List disablePadding={disablePadding}>{children}</List>;
}

interface AppListItemProps {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  primaryTextTransform?: 'capitalize' | 'uppercase' | 'lowercase' | 'none';
  secondaryAction?: React.ReactNode;
  divider?: boolean;
}

export function AppListItem({
  primary,
  secondary,
  primaryTextTransform,
  secondaryAction,
  divider,
}: AppListItemProps) {
  return (
    <ListItem divider={divider} secondaryAction={secondaryAction}>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{ primary: primaryTextTransform ? { sx: { textTransform: primaryTextTransform } } : undefined }}
      />
    </ListItem>
  );
}
