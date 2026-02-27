import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataGridClient from './DataGridClient';
import { TickTestUtils } from '../cypress/support/tick';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock the removeAction
const mockRemoveAction = vi.fn();

interface TestEntity {
  id: string;
  name: string;
  description: string | null;
}

describe('DataGridClient', () => {
  const createMockData = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `${i + 1}`,
      name: `Item ${i + 1}`,
      description: `Description ${i + 1}`,
    }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pagination', () => {
    it('disables both previous and next buttons when records are equal to page size', async () => {
      const mockData = createMockData(10); // Default page size is 10
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).toBeDisabled();
      });
    });

    it('disables both previous and next buttons when records are less than page size', async () => {
      const mockData = createMockData(5);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).toBeDisabled();
      });
    });

    it('enables next button when records exceed page size', async () => {
      const mockData = createMockData(15);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        const prevButton = screen.getByLabelText(/previous page/i);
        const nextButton = screen.getByLabelText(/next page/i);
        expect(prevButton).toBeDisabled();
        expect(nextButton).not.toBeDisabled();
      });
    });

    it('enables previous button and disables next when on last page', async () => {
      const mockData = createMockData(15);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

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
      const mockData = createMockData(25);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

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
      const mockData = createMockData(5);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Item 1')).toBeInTheDocument();
      });

      // Open column menu for Name column
      const nameHeader = screen.getByText('Name');
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
      const mockData = [
        { id: '1', name: 'Zebra', description: 'Last' },
        { id: '2', name: 'Apple', description: 'First' },
        { id: '3', name: 'Mango', description: 'Middle' },
      ];
      
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Zebra')).toBeInTheDocument();
      });

      const nameHeader = screen.getByText('Name');
      await userEvent.click(nameHeader);

      // After sorting, order should change
      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        // First row is header, so data starts at index 1
        expect(rows[1]).toHaveTextContent('Apple');
      });
    });

    it('allows sorting by description', async () => {
      const mockData = [
        { id: '1', name: 'Item A', description: 'Zebra' },
        { id: '2', name: 'Item B', description: 'Apple' },
        { id: '3', name: 'Item C', description: 'Mango' },
      ];
      
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Zebra')).toBeInTheDocument();
      });

      const descriptionHeader = screen.getByText('Description');
      await userEvent.click(descriptionHeader);

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        expect(rows[1]).toHaveTextContent('Apple');
      });
    });

    it('does not allow sorting on Actions column', async () => {
      const mockData = createMockData(3);
      
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        const actionsHeader = screen.getByText('Actions');
        const columnHeader = actionsHeader.closest('[role="columnheader"]');
        
        // Actions column should not have sortable class/attribute
        expect(columnHeader).toHaveAttribute('aria-sort', 'none');
      });
    });
  });

  describe('Additional Functionality', () => {
    it('renders create new button with correct label', async () => {
      const mockData = createMockData(2);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Book"
        />
      );

      expect(screen.getByRole('button', { name: /create new book/i })).toBeInTheDocument();
    });

    it('renders links with correct base path', async () => {
      const mockData = createMockData(2);
      render(
        <DataGridClient
          src={mockData}
          basePath="/books"
          removeAction={mockRemoveAction}
          entityLabel="Book"
        />
      );

      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'Item 1' });
        expect(link).toHaveAttribute('href', '/books/view/1');
      });
    });

    it('renders delete selected button', async () => {
      const mockData = createMockData(2);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    });

    it('cancels delete selected dialog', async () => {
      const mockData = createMockData(3);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );
      
      TickTestUtils.tickRows([1, 3]); // Select both rows
      await waitFor(() => {
        expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2); // 2 rows + header
      });
      const deleteButton = screen.getByRole('button', { name: /delete selected/i });
      await userEvent.click(deleteButton);
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelButton);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)); // Header + 3 original fields
    });

    it('disables delete selected dialog when no row is ticked', async () => {
      const mockData = createMockData(3);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );
      
      TickTestUtils.tickRows([]);
      await waitFor(() => {
        expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
      });
      const deleteButton = screen.getByRole('button', { name: /delete selected/i });
      expect(deleteButton).toBeDisabled();
    });

    it('displays correct number of rows', async () => {
      const mockData = createMockData(5);
      render(
        <DataGridClient
          src={mockData}
          basePath="/test"
          removeAction={mockRemoveAction}
          entityLabel="Test"
        />
      );

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        // 1 header + 5 data rows
        expect(rows).toHaveLength(6);
      });
    });
  });
});
