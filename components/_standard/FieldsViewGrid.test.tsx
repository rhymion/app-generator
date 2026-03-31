import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import useMediaQuery from '@mui/material/useMediaQuery';
import FieldsViewGrid from './FieldsViewGrid';
import type { GridColDef } from '@mui/x-data-grid';

// Mock DataGrid — testing FieldsViewGrid logic, not MUI DataGrid internals
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns }: { rows: Record<string, unknown>[]; columns: { field: string; headerName?: string }[] }) => (
    <div data-testid="data-grid">
      {rows.map((row) => (
        <div key={String(row.id)} data-testid="data-grid-row">
          {columns.map((col) => (
            <span key={col.field} data-field={col.field}>
              {String(row[col.field] ?? '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: vi.fn().mockReturnValue(false),
}));

const columns: GridColDef[] = [
  { field: 'id', headerName: 'ID', width: 100 },
  { field: 'name', headerName: 'Name', width: 200 },
  { field: 'status', headerName: 'Status', width: 150 },
];

const row1 = { id: '1', name: 'Widget A', status: 'Active' };
const row2 = { id: '2', name: 'Widget B', status: 'Inactive' };
const row3 = { id: '3', name: 'Widget C', status: 'Pending' };

describe('FieldsViewGrid', () => {
  describe('Desktop view (wide screen)', () => {
    beforeEach(() => {
      vi.mocked(useMediaQuery).mockReturnValue(false);
    });

    it('renders DataGrid with 0 rows', () => {
      render(<FieldsViewGrid fields={[]} columns={columns} />);
      expect(screen.getByTestId('data-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('data-grid-row')).not.toBeInTheDocument();
    });

    it('renders DataGrid with 1 row', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      expect(screen.getByTestId('data-grid')).toBeInTheDocument();
      expect(screen.getAllByTestId('data-grid-row')).toHaveLength(1);
      expect(screen.getByText('Widget A')).toBeInTheDocument();
    });

    it('renders DataGrid with multiple rows', () => {
      render(<FieldsViewGrid fields={[row1, row2, row3]} columns={columns} />);
      expect(screen.getAllByTestId('data-grid-row')).toHaveLength(3);
      expect(screen.getByText('Widget A')).toBeInTheDocument();
      expect(screen.getByText('Widget B')).toBeInTheDocument();
      expect(screen.getByText('Widget C')).toBeInTheDocument();
    });

    it('does not render the mobile card layout', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      expect(screen.queryByText('No items.')).not.toBeInTheDocument();
    });
  });

  describe('Mobile view (narrow screen)', () => {
    beforeEach(() => {
      vi.mocked(useMediaQuery).mockReturnValue(true);
    });

    it('shows empty state with 0 rows', () => {
      render(<FieldsViewGrid fields={[]} columns={columns} />);
      expect(screen.getByText('No items.')).toBeInTheDocument();
    });

    it('shows card content for 1 row', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      expect(screen.getByText('Widget A')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows all cards for multiple rows', () => {
      render(<FieldsViewGrid fields={[row1, row2, row3]} columns={columns} />);
      expect(screen.getByText('Widget A')).toBeInTheDocument();
      expect(screen.getByText('Widget B')).toBeInTheDocument();
      expect(screen.getByText('Widget C')).toBeInTheDocument();
    });

    it('excludes the id column from mobile cards', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      // ID header not shown in mobile card layout
      expect(screen.queryByText('ID:')).not.toBeInTheDocument();
      // Row id value not shown as a label
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });

    it('shows column header names as field labels', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      expect(screen.getByText(/Name:/)).toBeInTheDocument();
      expect(screen.getByText(/Status:/)).toBeInTheDocument();
    });

    it('skips fields with empty display values', () => {
      const rowWithNull = { id: '4', name: 'Widget D', status: null };
      render(<FieldsViewGrid fields={[rowWithNull]} columns={columns} />);
      expect(screen.getByText('Widget D')).toBeInTheDocument();
      expect(screen.queryByText(/Status:/)).not.toBeInTheDocument();
    });

    it('does not render the DataGrid component', () => {
      render(<FieldsViewGrid fields={[row1]} columns={columns} />);
      expect(screen.queryByTestId('data-grid')).not.toBeInTheDocument();
    });
  });

  describe('valueGetter and valueFormatter support', () => {
    it('applies valueGetter when provided', () => {
      const columnsWithGetter: GridColDef[] = [
        { field: 'id', headerName: 'ID' },
        {
          field: 'name',
          headerName: 'Name',
          valueGetter: (value: unknown) => `[${value}]`,
        },
      ];
      vi.mocked(useMediaQuery).mockReturnValue(true);
      render(<FieldsViewGrid fields={[row1]} columns={columnsWithGetter} />);
      expect(screen.getByText('[Widget A]')).toBeInTheDocument();
    });

    it('renders boolean fields as Yes/No in mobile view', () => {
      const boolColumns: GridColDef[] = [
        { field: 'id', headerName: 'ID' },
        { field: 'active', headerName: 'Active', type: 'boolean' },
      ];
      const boolRow = { id: '1', active: true };
      vi.mocked(useMediaQuery).mockReturnValue(true);
      render(<FieldsViewGrid fields={[boolRow]} columns={boolColumns} />);
      expect(screen.getByText('Yes')).toBeInTheDocument();
    });
  });
});
