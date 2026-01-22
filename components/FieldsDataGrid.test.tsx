import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldsDataGrid from './FieldsDataGrid';
import { DeleteTestUtils } from '@/utils/test/operations/delete';
import { TickTestUtils } from '@/utils/test/operations/tick';
import { GridColDef } from '@mui/x-data-grid';

describe('FieldsDataGrid', () => {
  const mockOnFieldsChange = vi.fn();
  const mockOnAddField = vi.fn();

  const mockFields = [
    { id: '1', name: 'field1', type: 'string', max_length: 100, max: null, regex: null, required: true },
    { id: '2', name: 'field2', type: 'number', max_length: null, max: 100, regex: null, required: false },
  ];

  const mockColumns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 150, editable: true },
    { field: 'type', headerName: 'Type', width: 100, editable: true },
    { field: 'max_length', headerName: 'Max Length', width: 120, editable: true, type: 'number' },
    { field: 'max', headerName: 'Max', width: 100, editable: true, type: 'number' },
    { field: 'regex', headerName: 'Regex', width: 150, editable: true },
    { field: 'required', headerName: 'Required', width: 100, editable: true, type: 'boolean' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders add button with custom label', () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
        addButtonLabel="Add Custom Field"
      />
    );
    expect(screen.getByRole('button', { name: /add custom field/i })).toBeInTheDocument();
  });

  it('renders add button with default label', () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    expect(screen.getByRole('button', { name: /add field/i })).toBeInTheDocument();
  });

  it('calls onAddField when add button is clicked', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(mockOnAddField).toHaveBeenCalledTimes(1);
  });

  it('displays all fields in the grid', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('field1')).toBeInTheDocument();
      expect(screen.getByText('field2')).toBeInTheDocument();
    });
  });

  it('handles pagination correctly', async () => {
    const manyFields = Array.from({ length: 15 }, (_, i) => ({
      id: `${i}`,
      name: `field${i}`,
      type: 'string',
      max_length: null,
      max: null,
      regex: null,
      required: false,
    }));

    render(
      <FieldsDataGrid
        fields={manyFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11)); // Header + 10
    const nextButton = screen.getByLabelText(/next/i);
    await userEvent.click(nextButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6)); // Header + 5 remaining
    const prevButton = screen.getByLabelText(/previous/i);
    await userEvent.click(prevButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11));
  });

  it('edits records successfully and calls onFieldsChange', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'newField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    
    await waitFor(() => {
      expect(mockOnFieldsChange).toHaveBeenCalled();
      const updatedFields = mockOnFieldsChange.mock.calls[0][0];
      expect(updatedFields.find((f: any) => f.id === '1').name).toBe('newField1');
    });
  });

  it('moves field up when up button is clicked', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]); // Click up on second field

    await waitFor(() => {
      expect(mockOnFieldsChange).toHaveBeenCalled();
      const updatedFields = mockOnFieldsChange.mock.calls[0][0];
      expect(updatedFields[0].id).toBe('2');
      expect(updatedFields[1].id).toBe('1');
    });
  });

  it('moves field down when down button is clicked', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    await userEvent.click(downButtons[0]); // Click down on first field

    await waitFor(() => {
      expect(mockOnFieldsChange).toHaveBeenCalled();
      const updatedFields = mockOnFieldsChange.mock.calls[0][0];
      expect(updatedFields[0].id).toBe('2');
      expect(updatedFields[1].id).toBe('1');
    });
  });

  it('disables up button for first row and down button for last row', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
  });

  it('disables delete selected button when no row is ticked', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    TickTestUtils.tickRows([]);
    await waitFor(() => {
      expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    });
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    expect(deleteButton).toBeDisabled();
  });

  it('deletes selected fields when confirmed', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first field
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await DeleteTestUtils.deleteSelectedRows(deleteButton);
    
    await waitFor(() => {
      expect(mockOnFieldsChange).toHaveBeenCalled();
      const updatedFields = mockOnFieldsChange.mock.calls[0][0];
      expect(updatedFields).toHaveLength(1);
      expect(updatedFields[0].id).toBe('2');
    });
  });

  it('shows confirmation dialog when clicking Delete Selected with ticked fields', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first field
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/delete selected fields/i)).toBeInTheDocument();
    });
  });

  it('cancels deletion when clicking Cancel in Delete Selected dialog', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockOnFieldsChange).not.toHaveBeenCalled();
  });

  it('displays custom dialog title and message', async () => {
    render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
        deleteDialogTitle="Remove Items?"
        deleteDialogMessage="Are you sure you want to remove these items?"
      />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => {
      expect(screen.getByText('Remove Items?')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to remove these items?')).toBeInTheDocument();
    });
  });

  it('handles complex operations: add, move, edit, and delete', async () => {
    const { rerender } = render(
      <FieldsDataGrid
        fields={mockFields}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );

    // Add field
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(mockOnAddField).toHaveBeenCalled();

    // Simulate field added
    const fieldsWithNew = [...mockFields, { id: '3', name: '', type: 'string', max_length: null, max: null, regex: null, required: false }];
    rerender(
      <FieldsDataGrid
        fields={fieldsWithNew}
        onFieldsChange={mockOnFieldsChange}
        columns={mockColumns}
        onAddField={mockOnAddField}
      />
    );

    // Move field
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]);
    expect(mockOnFieldsChange).toHaveBeenCalled();

    // Edit field
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'editedField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    
    await waitFor(() => {
      expect(mockOnFieldsChange).toHaveBeenCalled();
    });
  });
});
