import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import CardListClient from './CardListClient';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock @/i18n/navigation (replaces next/navigation in this component)
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

type Item = { id: string; name: string; description?: string };

const item1: Item = { id: '1', name: 'Alpha', description: 'First item' };
const item2: Item = { id: '2', name: 'Beta', description: 'Second item' };
const basePath = '/items';
const allPerms = { create: true, read: true, update: true, delete: true, import: true };

describe('CardListClient', () => {
  describe('Read (display)', () => {
    it('shows empty state with 0 items', () => {
      render(<CardListClient src={[]} basePath={basePath} />);
      expect(screen.getByText('No items found.')).toBeInTheDocument();
    });

    it('shows a single item with name and description', () => {
      render(<CardListClient src={[item1]} basePath={basePath} />);
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('First item')).toBeInTheDocument();
    });

    it('shows multiple items', () => {
      render(<CardListClient src={[item1, item2]} basePath={basePath} />);
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('links each item name to its view page', () => {
      render(<CardListClient src={[item1]} basePath={basePath} />);
      const link = screen.getByRole('link', { name: 'Alpha' });
      expect(link).toHaveAttribute('href', '/items/view/1');
    });

    it('uses item id as title when name is absent', () => {
      const noName = { id: 'xyz' };
      render(<CardListClient src={[noName]} basePath={basePath} />);
      expect(screen.getByText('xyz')).toBeInTheDocument();
    });

    it('uses entityLabel in the delete confirmation dialog title', () => {
      render(<CardListClient src={[item1]} basePath={basePath} entityLabel="Book" permissions={allPerms} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      expect(screen.getByText('Delete Book(s)?')).toBeInTheDocument();
    });
  });

  describe('Create', () => {
    it('shows create button when permissions.create=true', () => {
      render(<CardListClient src={[]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getByRole('button', { name: 'Create New Item' })).toBeInTheDocument();
    });

    it('hides create button when permissions.create=false', () => {
      render(<CardListClient src={[]} basePath={basePath} permissions={{ ...allPerms, create: false }} />);
      expect(screen.queryByRole('button', { name: 'Create New Item' })).not.toBeInTheDocument();
    });

    it('create button links to new page', () => {
      render(<CardListClient src={[]} basePath={basePath} permissions={allPerms} />);
      const btn = screen.getByRole('button', { name: 'Create New Item' });
      expect(btn.closest('a')).toHaveAttribute('href', '/items/new');
    });

    it('shows create button with 0 items before any addition', () => {
      render(<CardListClient src={[]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getByRole('button', { name: 'Create New Item' })).toBeInTheDocument();
      expect(screen.getByText('No items found.')).toBeInTheDocument();
    });

    it('shows create button with 1 existing item', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getByRole('button', { name: 'Create New Item' })).toBeInTheDocument();
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });
  });

  describe('Update', () => {
    it('shows edit button per item when permissions.update=true', () => {
      render(<CardListClient src={[item1, item2]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    });

    it('hides edit button when permissions.update=false', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={{ ...allPerms, update: false }} />);
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });

    it('edit button links to edit page', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      const editLink = screen.getByRole('button', { name: 'Edit' }).closest('a');
      expect(editLink).toHaveAttribute('href', '/items/edit/1');
    });
  });

  describe('Delete', () => {
    it('shows delete button when permissions.delete=true', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeInTheDocument();
    });

    it('hides delete button and checkboxes when permissions.delete=false', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={{ ...allPerms, delete: false }} />);
      expect(screen.queryByRole('button', { name: 'Delete Selected' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('delete button is disabled when no items are selected', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeDisabled();
    });

    it('delete button is enabled after selecting an item', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      expect(screen.getByRole('button', { name: 'Delete Selected' })).not.toBeDisabled();
    });

    it('opens confirmation dialog when delete button is clicked', () => {
      render(<CardListClient src={[item1]} basePath={basePath} permissions={allPerms} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      expect(screen.getByText('Delete Item(s)?')).toBeInTheDocument();
    });

    it('calls removeAction with selected id when 1 item is selected and confirmed', async () => {
      const removeAction = vi.fn().mockResolvedValue(undefined);
      render(
        <CardListClient
          src={[item1]}
          basePath={basePath}
          permissions={allPerms}
          removeAction={removeAction}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(removeAction).toHaveBeenCalledWith(['1']);
      });
    });

    it('calls removeAction with all selected ids when multiple items are selected', async () => {
      const removeAction = vi.fn().mockResolvedValue(undefined);
      render(
        <CardListClient
          src={[item1, item2]}
          basePath={basePath}
          permissions={allPerms}
          removeAction={removeAction}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(removeAction).toHaveBeenCalledWith(expect.arrayContaining(['1', '2']));
      });
    });

    it('does not call removeAction when the dialog is cancelled', () => {
      const removeAction = vi.fn();
      render(
        <CardListClient
          src={[item1]}
          basePath={basePath}
          permissions={allPerms}
          removeAction={removeAction}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(removeAction).not.toHaveBeenCalled();
    });

    it('closes the dialog after confirming deletion', async () => {
      const removeAction = vi.fn().mockResolvedValue(undefined);
      render(
        <CardListClient
          src={[item1]}
          basePath={basePath}
          permissions={allPerms}
          removeAction={removeAction}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      expect(screen.getByText('Delete Item(s)?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(screen.queryByText('Delete Item(s)?')).not.toBeInTheDocument();
      });
    });

    it('clears selection after confirming deletion', async () => {
      const removeAction = vi.fn().mockResolvedValue(undefined);
      render(
        <CardListClient
          src={[item1]}
          basePath={basePath}
          permissions={allPerms}
          removeAction={removeAction}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      expect(screen.getByRole('button', { name: 'Delete Selected' })).not.toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeDisabled();
      });
    });
  });
});
