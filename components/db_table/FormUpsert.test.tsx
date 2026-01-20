// We recommend installing an extension to run vitest tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormUpsert from './FormUpsert';
import { DeleteTestUtils } from '@/utils/test/operations/delete';
import { TickTestUtils } from '@/utils/test/operations/tick';

// Mock the actions
vi.mock('@/lib/db_table/actions', () => ({
  upsertDbTable: vi.fn(),
  removeDbTable: vi.fn(),
}));

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

  it('has Add, Delete Selected, Save and Back to List buttons for non-edit mode', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete table/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('has Add, Delete Selected, Save, Delete Table and Back to List buttons for edit mode', async () => {
    render(<FormUpsert src={mockSrc} isEdit={true} />);
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete table/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('adds a new record (field) successfully', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    expect(screen.getByText('field1')).toBeInTheDocument();
    expect(screen.getByText('field2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)); // Header + 3 rows
  });

  it('adds multiple records and handles pagination', async () => {
    const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, name: `field${i}`, table_id: '1', type: 'string', max_length: null, max: null, regex: null, required: false })) };
    render(<FormUpsert src={srcWithManyFields} isEdit={false} />);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11)); // Header + 10
    const nextButton = screen.getByLabelText(/next/i);
    await userEvent.click(nextButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6)); // Header + 5 remaining
    const prevButton = screen.getByLabelText(/previous/i);
    await userEvent.click(prevButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11));
  });

  it('edits records successfully and reflects changes', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'newField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('newField1')).toBeInTheDocument());
  });

  it('moves up and down records successfully', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]);
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1]).toHaveTextContent('field2');
    });
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    await userEvent.click(downButtons[0]);
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1]).toHaveTextContent('field1');
    });
  });

  it('deletes rows successfully by selecting and clicking delete', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await DeleteTestUtils.deleteSelectedRows(deleteButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)); // Header + 1 remaining
  });

  it('keeps edited rows after add, move, and delete', async () => {
    render(<FormUpsert src={mockSrc} isEdit={true} />);
    await userEvent.dblClick(screen.getByText('field1'));
    const editCell = screen.getByDisplayValue('field1');
    await userEvent.clear(editCell);
    await userEvent.type(editCell, 'editedField1');
    fireEvent.keyDown(editCell, { key: 'Enter' });
    const addButton = screen.getByRole('button', { name: /add field/i });
    await userEvent.click(addButton);
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    await userEvent.click(upButtons[1]);
    const checkboxes = screen.getAllByRole('checkbox');
    await TickTestUtils.tickRows([1]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4));
    await DeleteTestUtils.deleteSelectedRows(deleteButton);
    await waitFor(() => expect(screen.getByText('editedField1')).toBeInTheDocument());
  });

  it('disables up button for first row and down button for last row', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const upButtons = screen.getAllByRole('button', { name: '↑' });
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
  });

  // New test cases for confirmation dialogs

  it('shows confirmation dialog when clicking Delete Selected with ticked fields', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first field
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/delete selected fields/i)).toBeInTheDocument();
    });
  });

  it('confirms deletion when clicking Delete button in Delete Selected dialog', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Select first field
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await DeleteTestUtils.deleteSelectedRows(deleteButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)); // Header + 1 remaining
  });

  it('cancels deletion when clicking Cancel in Delete Selected dialog', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);
    const deleteButton = screen.getByRole('button', { name: /delete selected/i });
    await userEvent.click(deleteButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3)); // Header + 2 original fields
  });

  it('shows confirmation dialog when clicking Delete Table button', async () => {
    render(<FormUpsert src={mockSrc} isEdit={true} />);
    const deleteTableButton = screen.getByRole('button', { name: /delete table/i });
    await userEvent.click(deleteTableButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: /delete table/i })).toBeInTheDocument());
    //await waitFor(() => expect(screen.getByText(/delete table/i)).toBeInTheDocument());
  });

  it('cancels deletion when clicking Cancel in Delete Table dialog', async () => {
    render(<FormUpsert src={mockSrc} isEdit={true} />);
    const deleteTableButton = screen.getByRole('button', { name: /delete table/i });
    await userEvent.click(deleteTableButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows confirmation dialog when clicking Back to List button', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const backButton = screen.getByRole('button', { name: /back to list/i });
    await userEvent.click(backButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: /go back/i })).toBeInTheDocument());
  });

  it('cancels navigation when clicking Cancel in Back to List dialog', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const backButton = screen.getByRole('button', { name: /back to list/i });
    await userEvent.click(backButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});