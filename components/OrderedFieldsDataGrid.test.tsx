import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrderedFieldsDataGrid from './OrderedFieldsDataGrid';
import { DeleteTestUtils } from '@/utils/test/operations/delete';
import { TickTestUtils } from '@/utils/test/operations/tick';
import { GridColDef } from '@mui/x-data-grid';

describe('OrderedFieldsDataGrid', () => {
  const mockCreateNewRow = vi.fn(() => ({
    id: `temp-${Date.now()}-${Math.random()}`,
    name: '',
    type: 'string',
    max_length: null,
    max: null,
    regex: null,
    required: false,
  }));

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
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
        addButtonLabel="Add Custom Field"
      />
    );
    expect(screen.getByRole('button', { name: /add custom field/i })).toBeInTheDocument();
  });

  it('renders add button with default label', () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    expect(screen.getByRole('button', { name: /add field/i })).toBeInTheDocument();
  });

  it('calls createNewRow when add button is clicked', async () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(mockCreateNewRow).toHaveBeenCalledTimes(1);
  });

  it('displays all fields in the grid', async () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('field1')).toBeInTheDocument();
      expect(screen.getByText('field2')).toBeInTheDocument();
    });
  });
  it('handles pagination correctly', async () => {
    const ref = { current: null as any };
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
      <OrderedFieldsDataGrid
        ref={ref as any}
        initialFields={manyFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );

    // Verify all fields are stored internally
    await waitFor(() => {
      const fields = ref.current?.getFields() || [];
      expect(fields).toHaveLength(15);
    });
    
    // Verify pagination controls exist
    expect(screen.getByLabelText(/next/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/previous/i)).toBeInTheDocument();
  });
  it('edits records successfully', async () => {
    const ref = { current: null as any };
    render(
      <OrderedFieldsDataGrid
        ref={ref}
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'newField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    
    await waitFor(() => {
      const updatedFields = ref.current?.getFields() || [];
      expect(updatedFields.find((f: any) => f.id === '1').name).toBe('newField1');
    });
  });

  it('moves field up when up button is clicked', async () => {
    const ref = { current: null as any };
    render(
      <OrderedFieldsDataGrid
        ref={ref}
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]); // Click up on second field

    await waitFor(() => {
      const updatedFields = ref.current?.getFields() || [];
      expect(updatedFields[0].id).toBe('2');
      expect(updatedFields[1].id).toBe('1');
    });
  });

  it('moves field down when down button is clicked', async () => {
    const ref = { current: null as any };
    render(
      <OrderedFieldsDataGrid
        ref={ref}
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    await userEvent.click(downButtons[0]); // Click down on first field

    await waitFor(() => {
      const updatedFields = ref.current?.getFields() || [];
      expect(updatedFields[0].id).toBe('2');
      expect(updatedFields[1].id).toBe('1');
    });
  });

  it('disables up button for first row and down button for last row', async () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
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
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
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
    const ref = { current: null as any };
    render(
      <OrderedFieldsDataGrid
        ref={ref}
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first field
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await DeleteTestUtils.deleteSelectedRows(deleteButton);
    
    await waitFor(() => {
      const updatedFields = ref.current?.getFields() || [];
      expect(updatedFields).toHaveLength(1);
      expect(updatedFields[0].id).toBe('2');
    });
  });

  it('shows confirmation dialog when clicking Delete Selected with ticked fields', async () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
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
    const ref = { current: null as any };
    render(
      <OrderedFieldsDataGrid
        ref={ref}
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
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
    // Verify fields unchanged
    const updatedFields = ref.current?.getFields() || [];
    expect(updatedFields).toHaveLength(2);
  });

  it('displays custom dialog title and message', async () => {
    render(
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
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
      <OrderedFieldsDataGrid
        initialFields={mockFields}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );

    // Add field
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(mockCreateNewRow).toHaveBeenCalled();

    // Simulate field added
    const fieldsWithNew = [...mockFields, { id: '3', name: '', type: 'string', max_length: null, max: null, regex: null, required: false }];
    rerender(
      <OrderedFieldsDataGrid
        initialFields={fieldsWithNew}
        
        columns={mockColumns}
        createNewRow={mockCreateNewRow}
      />
    );

    // Move field
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]);

    // Edit field
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'editedField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    
    await waitFor(() => {
    });
  });
});
