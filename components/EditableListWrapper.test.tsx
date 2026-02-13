import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditableListWrapper from './EditableListWrapper';

describe('EditableListWrapper', () => {
  it('renders empty state when there are no items', () => {
    render(<EditableListWrapper initialItems={[]} itemType="text" />);
    expect(screen.getByText('No items yet')).toBeInTheDocument();
  });

  it('renders a single item', () => {
    render(
      <EditableListWrapper
        itemType="text"
        initialItems={[{ id: '1', value: 'One', label: 'Item One' }]}
      />
    );

    expect(screen.getByText('Item One')).toBeInTheDocument();
    expect(screen.queryByText('No items yet')).not.toBeInTheDocument();
  });

  it('renders multiple items', () => {
    render(
      <EditableListWrapper
        itemType="text"
        initialItems={[
          { id: '1', value: 'One', label: 'Item One' },
          { id: '2', value: 'Two', label: 'Item Two' },
          { id: '3', value: 'Three', label: 'Item Three' },
        ]}
      />
    );

    expect(screen.getByText('Item One')).toBeInTheDocument();
    expect(screen.getByText('Item Two')).toBeInTheDocument();
    expect(screen.getByText('Item Three')).toBeInTheDocument();
  });

  it('adds and deletes an autocomplete item', async () => {
    const user = userEvent.setup();

    render(
      <EditableListWrapper
        itemType="autocomplete"
        autocompleteOptions={[
          { id: '1', label: 'Alpha' },
          { id: '2', label: 'Beta' },
        ]}
      />
    );

    await user.click(screen.getByRole('button', { name: /add item/i }));
    let addDialog = screen.getByRole('dialog', { name: /add items/i });
    let combo = within(addDialog).getByLabelText(/select/i);
    await user.click(combo);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    await user.click(within(addDialog).getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add item/i }));
    addDialog = screen.getByRole('dialog', { name: /add items/i });
    combo = within(addDialog).getByLabelText(/select/i);
    await user.click(combo);
    await user.click(screen.getByRole('option', { name: 'Beta' }));
    await user.click(within(addDialog).getByRole('button', { name: /add/i }));

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Beta')).toBeInTheDocument();

    const itemRow = screen.getByText('Alpha').closest('li');
    expect(itemRow).not.toBeNull();
    if (!itemRow) {
      throw new Error('Expected list item for Alpha');
    }

    const deleteButton = itemRow.querySelector('button[aria-label="delete"]') as HTMLElement | null;
    expect(deleteButton).not.toBeNull();
    if (!deleteButton) {
      throw new Error('Expected delete button for Alpha');
    }

    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
  });

  it('adds, edits, and deletes a text item', async () => {
    const user = userEvent.setup();

    render(<EditableListWrapper itemType="text" />);

    await user.click(screen.getByRole('button', { name: /add item/i }));
    let addDialog = screen.getByRole('dialog', { name: /add items/i });
    await user.type(within(addDialog).getByLabelText(/value/i), 'First');
    await user.click(within(addDialog).getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add item/i }));
    addDialog = screen.getByRole('dialog', { name: /add items/i });
    await user.type(within(addDialog).getByLabelText(/value/i), 'Second');
    await user.click(within(addDialog).getByRole('button', { name: /add/i }));

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(await screen.findByText('Second')).toBeInTheDocument();

    const itemRow = screen.getByText('First').closest('li');
    expect(itemRow).not.toBeNull();
    if (!itemRow) {
      throw new Error('Expected list item for First');
    }

    const editButton = itemRow.querySelector('button[aria-label="edit"]') as HTMLElement | null;
    expect(editButton).not.toBeNull();
    if (!editButton) {
      throw new Error('Expected edit button for First');
    }

    await user.click(editButton);

    const editDialog = screen.getByRole('dialog', { name: /edit items/i });
    const editInput = within(editDialog).getByLabelText(/value/i);
    await user.clear(editInput);
    await user.type(editInput, 'Updated');
    await user.click(within(editDialog).getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Updated')).toBeInTheDocument();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();

    const updatedRow = screen.getByText('Updated').closest('li');
    expect(updatedRow).not.toBeNull();
    if (!updatedRow) {
      throw new Error('Expected list item for Updated');
    }

    const deleteButton = updatedRow.querySelector('button[aria-label="delete"]') as HTMLElement | null;
    expect(deleteButton).not.toBeNull();
    if (!deleteButton) {
      throw new Error('Expected delete button for Updated');
    }

    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByText('Updated')).not.toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  describe('Internal Filtering', () => {
    it('should filter out selected items from autocomplete options', async () => {
      const user = userEvent.setup();

      const allOptions = [
        { id: '1', label: 'Option 1' },
        { id: '2', label: 'Option 2' },
        { id: '3', label: 'Option 3' },
      ];

      const initialItems = [
        { id: '1', value: '1', label: 'Option 1', originalId: '1' },
      ];

      render(
        <EditableListWrapper
          initialItems={initialItems}
          itemType="autocomplete"
          allAutocompleteOptions={allOptions}
        />
      );

      // Verify initial item is displayed
      expect(screen.getByText('Option 1')).toBeInTheDocument();

      // Open add dialog
      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const combo = within(addDialog).getByLabelText(/select/i);

      // Click to open autocomplete dropdown
      await user.click(combo);

      // Should only show Option 2 and Option 3 (Option 1 is selected)
      await waitFor(() => {
        expect(screen.queryByRole('option', { name: 'Option 1' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
      });
    });

    it('should exclude IDs from excludeOptionIds', async () => {
      const user = userEvent.setup();

      const allOptions = [
        { id: '1', label: 'Option 1' },
        { id: '2', label: 'Option 2' },
        { id: '3', label: 'Option 3' },
      ];

      render(
        <EditableListWrapper
          initialItems={[]}
          itemType="autocomplete"
          allAutocompleteOptions={allOptions}
          excludeOptionIds={['2']}  // Exclude Option 2 (e.g., src.id)
        />
      );

      // Open add dialog
      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const combo = within(addDialog).getByLabelText(/select/i);

      // Click to open autocomplete dropdown
      await user.click(combo);

      // Should show Option 1 and 3, but not 2
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Option 2' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
      });
    });

    it('should dynamically update available options when items are added', async () => {
      const user = userEvent.setup();

      const allOptions = [
        { id: '1', label: 'Option 1' },
        { id: '2', label: 'Option 2' },
        { id: '3', label: 'Option 3' },
      ];

      render(
        <EditableListWrapper
          initialItems={[]}
          itemType="autocomplete"
          allAutocompleteOptions={allOptions}
        />
      );

      // Add Option 1
      await user.click(screen.getByRole('button', { name: /add item/i }));
      let addDialog = screen.getByRole('dialog', { name: /add items/i });
      let combo = within(addDialog).getByLabelText(/select/i);
      await user.click(combo);
      await user.click(screen.getByRole('option', { name: 'Option 1' }));
      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
      });

      // Verify Option 1 was added
      expect(screen.getByText('Option 1')).toBeInTheDocument();

      // Open add dialog again
      await user.click(screen.getByRole('button', { name: /add item/i }));
      addDialog = screen.getByRole('dialog', { name: /add items/i });
      combo = within(addDialog).getByLabelText(/select/i);
      await user.click(combo);

      // Option 1 should now be excluded from available options
      await waitFor(() => {
        expect(screen.queryByRole('option', { name: 'Option 1' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
      });
    });

    it('should maintain backward compatibility with autocompleteOptions', async () => {
      const user = userEvent.setup();

      const options = [
        { id: '1', label: 'Option 1' },
        { id: '2', label: 'Option 2' },
      ];

      render(
        <EditableListWrapper
          initialItems={[]}
          itemType="autocomplete"
          autocompleteOptions={options}  // Old API
        />
      );

      // Open add dialog
      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const combo = within(addDialog).getByLabelText(/select/i);
      await user.click(combo);

      // Should still work with old prop
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
      });
    });
  });

  describe('File and Image', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('renders file items as download links', () => {
      render(
        <EditableListWrapper
          itemType="file"
          fileVariant="file"
          initialItems={[
            { id: '1', value: '/uploads/doc.pdf', label: 'doc.pdf' },
          ]}
        />
      );

      const link = screen.getByRole('link', { name: 'doc.pdf' });
      expect(link).toHaveAttribute('href', '/uploads/doc.pdf');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders image items with thumbnail previews', () => {
      render(
        <EditableListWrapper
          itemType="file"
          fileVariant="image"
          initialItems={[
            { id: '1', value: '/uploads/photo.png', label: 'photo.png' },
          ]}
        />
      );

      expect(screen.getByText('photo.png')).toBeInTheDocument();
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/uploads/photo.png');
      expect(img).toHaveAttribute('alt', 'photo.png');
    });

    it('uploads a file and adds it to the list', async () => {
      const user = userEvent.setup();
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: '/uploads/test-file.pdf' }),
      } as Response);

      render(
        <EditableListWrapper
          itemType="file"
          fileVariant="file"
          initialItems={[]}
        />
      );

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const fileInput = addDialog.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test-file.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledOnce();
      const link = screen.getByRole('link', { name: 'test-file.pdf' });
      expect(link).toHaveAttribute('href', '/uploads/test-file.pdf');
    });

    it('shows error when upload fails', async () => {
      const user = userEvent.setup();
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'File too large' }),
      } as Response);

      render(
        <EditableListWrapper
          itemType="file"
          fileVariant="file"
          initialItems={[]}
        />
      );

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const fileInput = addDialog.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'big-file.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText('File too large')).toBeInTheDocument();
      });

      // Dialog should still be open
      expect(screen.getByRole('dialog', { name: /add items/i })).toBeInTheDocument();
    });
  });
});
