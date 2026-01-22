// We recommend installing an extension to run vitest tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormUpsert from './FormUpsert';

// Mock the actions
vi.mock('@/lib/db_table/actions', () => ({
  upsertDbTable: vi.fn(),
  removeDbTable: vi.fn(),
}));

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
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

  it('renders form fields correctly', () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const nameInput = screen.getByDisplayValue('Test Table');
    const descInput = screen.getByDisplayValue('Test Description');
    expect(nameInput).toBeInTheDocument();
    expect(descInput).toBeInTheDocument();
  });

  it('has Add, Delete Selected, Save and Back to List buttons for non-edit mode', () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete table/i })).not.toBeInTheDocument();
  });

  it('has Add, Delete Selected, Save, Delete Table and Back to List buttons for edit mode', () => {
    render(<FormUpsert src={mockSrc} isEdit={true} />);
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete table/i })).toBeInTheDocument();
  });

  it('renders FieldsDataGrid component', () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    expect(screen.getByText('Fields')).toBeInTheDocument();
    expect(screen.getByText('field1')).toBeInTheDocument();
    expect(screen.getByText('field2')).toBeInTheDocument();
  });

  it('updates name field when user types', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const nameInput = screen.getByDisplayValue('Test Table');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Table Name');
    expect(nameInput).toHaveValue('New Table Name');
  });

  it('updates description field when user types', async () => {
    render(<FormUpsert src={mockSrc} isEdit={false} />);
    const descInput = screen.getByDisplayValue('Test Description');
    await userEvent.clear(descInput);
    await userEvent.type(descInput, 'New Description');
    expect(descInput).toHaveValue('New Description');
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