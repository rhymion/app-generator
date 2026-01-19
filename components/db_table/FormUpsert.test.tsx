// We recommend installing an extension to run vitest tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormUpsert from './FormUpsert';

// Mock the actions
vi.mock('@/lib/db_table/actions', () => ({
  upsertDbTable: vi.fn(),
  removeDbTable: vi.fn(),
}));

// Mock MUI components if needed, but for simplicity, assume they work
// You might need to mock @mui/x-data-grid if rendering issues occur

describe('FormUpsert', () => {
  const mockSrc = {
    id: '1',
    name: 'Test Table',
    description: 'Test Description',
    fields: [
      { id: '1', name: 'field1', table_id: '1', type: 'string', max_length: 100, max: null, regex: null, required: true },
      { id: '2', name: 'field2', table_id: '1', type: 'number', max_length: null, max: 100, regex: null, required: false },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a new record (field) successfully', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(screen.getByText('field1')).toBeInTheDocument(); // Existing field
    expect(screen.getByText('field2')).toBeInTheDocument();
    // New field should be added, but since it's a grid, check for increased rows
    // Assuming the grid renders rows, you might need to query the grid API or cells
    // For simplicity, check if the add action was triggered (but it's internal)
    // Actually, since it's state change, perhaps check the number of rows
    // DataGrid might need special handling; this is a placeholder
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)); // Header + 3 rows
  });

  it('adds multiple records and handles pagination', async () => {
    // Add more than 10 fields to test pagination
    const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, name: `field${i}`, table_id: '1', type: 'string', max_length: null, max: null, regex: null, required: false })) };
    render(<FormUpsert src={srcWithManyFields} isEdit={false} />);
    // Check initial page shows 10 rows
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11)); // Header + 10
    // Simulate next page (assuming pagination controls are rendered)
    const nextButton = screen.getByLabelText( /next/i ); // Adjust based on MUI DataGrid
    await userEvent.click(nextButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6)); // Header + 5 remaining
    // Go back
    const prevButton = screen.getByLabelText( /previous/i ); // Adjust based on MUI DataGrid
    await userEvent.click(prevButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11));
  });

  it('edits records successfully and reflects changes', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    // Find the cell for editing (assuming DataGrid allows editing)
    // This might require querying specific cells; for simplicity, assume edit mode
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1'); // Assuming it's editable
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'newField1');
    // Stop editing (simulate enter or click outside)
    fireEvent.keyDown(editCell, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('newField1')).toBeInTheDocument());
  });

  it('moves up and down records successfully', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    // Find up button for second row
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]); // Second row's up button
    // Check order changed (first row now has field2)
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1]).toHaveTextContent('field2'); // Assuming row text includes name
    });
    // Move down
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    await userEvent.click(downButtons[0]); // First row's down button
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1]).toHaveTextContent('field1');
    });
  });

  it('deletes rows successfully by selecting and clicking delete', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    // Select rows (checkboxes)
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first data row
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)); // Header + 1 remaining
  });

  it('keeps edited rows after add, move, and delete', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    // Edit a field
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    //screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'editedField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    // Add new field
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    // Move up/down
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[2]);
    // Delete another
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[2]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    // Check edited field is still there
    await waitFor(() => expect(screen.getByText('editedField1')).toBeInTheDocument());
  });

  it('disables up button for first row and down button for last row', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    expect(upButtons[0]).toBeDisabled(); // First row up disabled
    expect(downButtons[downButtons.length - 1]).toBeDisabled(); // Last row down disabled
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
  });
});