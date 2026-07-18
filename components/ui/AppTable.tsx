import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import React from 'react';

interface AppTableProps {
  children: React.ReactNode;
  size?: 'small' | 'medium';
  ariaLabel?: string;
}

export function AppTable({ children, size, ariaLabel }: AppTableProps) {
  return (
    <Table size={size} aria-label={ariaLabel}>
      {children}
    </Table>
  );
}

interface AppTableHeadProps {
  children: React.ReactNode;
}

export function AppTableHead({ children }: AppTableHeadProps) {
  return <TableHead>{children}</TableHead>;
}

interface AppTableBodyProps {
  children: React.ReactNode;
}

export function AppTableBody({ children }: AppTableBodyProps) {
  return <TableBody>{children}</TableBody>;
}

interface AppTableRowProps {
  children: React.ReactNode;
}

export function AppTableRow({ children }: AppTableRowProps) {
  return <TableRow>{children}</TableRow>;
}

interface AppTableCellProps {
  children: React.ReactNode;
  fontFamily?: string;
}

export function AppTableCell({ children, fontFamily }: AppTableCellProps) {
  return <TableCell sx={fontFamily !== undefined ? { fontFamily } : undefined}>{children}</TableCell>;
}
