// We recommend installing an extension to run vitest tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormView from './FormView';

describe('FormView', () => {
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

  it('has Edit and Back to List buttons', async () => {
    render(<FormView src={mockSrc} />);
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    //await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)); // Header + 3 rows
  });

  it('has multiple records and handles pagination', async () => {
    const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, name: `field${i}`, table_id: '1', type: 'string', max_length: null, max: null, regex: null, required: false })) };
    render(<FormView src={srcWithManyFields} />);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11)); // Header + 10
    const nextButton = screen.getByLabelText(/next/i);
    await userEvent.click(nextButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6)); // Header + 5 remaining
    const prevButton = screen.getByLabelText(/previous/i);
    await userEvent.click(prevButton);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11));
  });

  it('cannot edit records', async () => {
    render(<FormView src={mockSrc} />);
    await userEvent.dblClick(screen.getByText('field1'));
    expect(screen.queryByDisplayValue('field1')).not.toBeInTheDocument();
  });
});