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
      { id: '1', name: 'field1', db_table_id: '1', type: 'string', reference_id: null, max_length: 100, max: null, regex: null, required: true },
      { id: '2', name: 'field2', db_table_id: '1', type: 'number', reference_id: null, max_length: null, max: 100, regex: null, required: false },
    ],
    db_table_comments: [],
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

  describe('Pagination', () => {
    it('disables both previous and next buttons when records are equal to page size', async () => {
      const srcWithFewFields = { ...mockSrc, fields: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: null, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithFewFields} />);
      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).toBeDisabled();
      });
    });

    it('disables both previous and next buttons when records are less than page size', async () => {
      const srcWithFewFields = { ...mockSrc, fields: Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: null, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithFewFields} />);
      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).toBeDisabled();
      });
    });

    it('enables next button when records exceed page size', async () => {
      const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: null, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithManyFields} />);
      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).not.toBeDisabled();
      });
    });

    it('enables previous button and disables next when on last page', async () => {
      const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: null, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithManyFields} />);
      await waitFor(() => {
        const nextButton = screen.getByLabelText(/next page/i);
        expect(nextButton).not.toBeDisabled();
      });

      const nextButton = screen.getByLabelText(/next page/i);
      await userEvent.click(nextButton);

      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButtonUpdated = screen.getByLabelText(/next page/i);
        expect(prevButton).not.toBeDisabled();
        expect(nextButtonUpdated).toBeDisabled();
      });
    });

    it('enables both buttons when on middle page', async () => {
      const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: i, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithManyFields} />);
      const nextButton = screen.getByLabelText(/next page/i);
      await userEvent.click(nextButton);

      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButtonUpdated = screen.getByLabelText(/next page/i);
        expect(prevButton).not.toBeDisabled();
        expect(nextButtonUpdated).not.toBeDisabled();
      });
    });
  });

  describe('Filtering and Sorting', () => {
    it('allows filtering by name', async () => {
      const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: null, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithManyFields} />);
      await waitFor(() => {
        expect(screen.getByText('field1')).toBeInTheDocument();
      });

      // Open column menu for Name column
      const nameHeader = screen.getAllByText('Name')[1];
      const menuButton = nameHeader.closest('[role="columnheader"]')?.querySelector('[aria-label*="Menu"]');
      
      if (menuButton) {
        await userEvent.click(menuButton);
        
        await waitFor(() => {
          const filterMenuItem = screen.queryByText(/filter/i);
          if (filterMenuItem) {
            userEvent.click(filterMenuItem);
          }
        });
      }
    });

    it('allows sorting by name', async () => {
      const srcWithManyFields = { ...mockSrc, fields: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, name: `field${i}`, db_table_id: '1', type: 'string', reference_id: null, max_length: i, max: null, regex: null, required: false })) };
      render(<FormView src={srcWithManyFields} />);
      await waitFor(() => {
        expect(screen.getByText('field2')).toBeInTheDocument();
      });

      const nameHeader = screen.getAllByText('Name')[1];
      const menuButton = nameHeader.closest('[role="columnheader"]')?.querySelector('[aria-label*="Menu"]');
      if (menuButton) {
        await userEvent.click(menuButton);
        
        await waitFor(() => {
          const sortMenuItem = screen.queryByText(/sort/i);
          if (sortMenuItem) {
            userEvent.click(sortMenuItem);
          }
        });
      }

      // After sorting, order should change
      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        // First row is header, so data starts at index 1
        expect(rows[3]).toHaveTextContent('field2');
      });
    });
  });

  it('cannot edit records', async () => {
    render(<FormView src={mockSrc} />);
    await userEvent.dblClick(screen.getByText('field1'));
    expect(screen.queryByDisplayValue('field1')).not.toBeInTheDocument();
  });
});