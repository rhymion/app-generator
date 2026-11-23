import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrderedEditableListWrapper from './OrderedEditableListWrapper';

describe('OrderedEditableListWrapper', () => {
  it('renders a file URL as a link and image only when it is a safe http(s) or root-relative URL', () => {
    const { container } = render(
      <OrderedEditableListWrapper
        itemType="file"
        fileVariant="image"
        initialItems={[
          { id: '1', value: '/uploads/ok.png', label: 'safe' },
          { id: '2', value: 'javascript:alert(1)', label: 'unsafe-js' },
          { id: '3', value: '//evil.example/x.png', label: 'unsafe-protocol-relative' },
        ]}
      />
    );
    expect(screen.getByText('safe').closest('a')).toHaveAttribute('href', '/uploads/ok.png');
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['/uploads/ok.png']);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="//"]')).toBeNull();
  });

  it('renders empty state when there are no items', () => {
    render(<OrderedEditableListWrapper initialItems={[]} itemType="text" />);
    expect(screen.getByText('No items yet')).toBeInTheDocument();
  });

  it('renders a single item with order number', () => {
    render(
      <OrderedEditableListWrapper
        itemType="text"
        initialItems={[{ id: '1', value: 'One', label: 'Item One' }]}
      />
    );

    expect(screen.getByText('Item One')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.queryByText('No items yet')).not.toBeInTheDocument();
  });

  it('renders multiple items with order numbers', () => {
    render(
      <OrderedEditableListWrapper
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

    const listItems = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(within(listItems[0]).getByText('1.')).toBeInTheDocument();
    expect(within(listItems[1]).getByText('2.')).toBeInTheDocument();
    expect(within(listItems[2]).getByText('3.')).toBeInTheDocument();
  });

  it('adds and deletes an autocomplete item', async () => {
    const user = userEvent.setup();

    render(
      <OrderedEditableListWrapper
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

    render(<OrderedEditableListWrapper itemType="text" />);

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
        <OrderedEditableListWrapper
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
        <OrderedEditableListWrapper
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
        <OrderedEditableListWrapper
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
        <OrderedEditableListWrapper
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

  describe('Ordering', () => {
    it('disables both move buttons when there is only one item', () => {
      render(
        <OrderedEditableListWrapper
          itemType="text"
          initialItems={[{ id: '1', value: 'Only', label: 'Only Item' }]}
        />
      );

      const item = screen.getByText('Only Item').closest('li')!;
      expect(item.querySelector('button[aria-label="move up"]')).toBeDisabled();
      expect(item.querySelector('button[aria-label="move down"]')).toBeDisabled();
    });

    it('disables move up for first item and move down for last item', () => {
      render(
        <OrderedEditableListWrapper
          itemType="text"
          initialItems={[
            { id: '1', value: 'A', label: 'First' },
            { id: '2', value: 'B', label: 'Middle' },
            { id: '3', value: 'C', label: 'Last' },
          ]}
        />
      );

      const firstItem = screen.getByText('First').closest('li')!;
      const middleItem = screen.getByText('Middle').closest('li')!;
      const lastItem = screen.getByText('Last').closest('li')!;

      expect(firstItem.querySelector('button[aria-label="move up"]')).toBeDisabled();
      expect(firstItem.querySelector('button[aria-label="move down"]')).not.toBeDisabled();

      expect(middleItem.querySelector('button[aria-label="move up"]')).not.toBeDisabled();
      expect(middleItem.querySelector('button[aria-label="move down"]')).not.toBeDisabled();

      expect(lastItem.querySelector('button[aria-label="move up"]')).not.toBeDisabled();
      expect(lastItem.querySelector('button[aria-label="move down"]')).toBeDisabled();
    });

    it('moves an item down when clicking move down button', async () => {
      const user = userEvent.setup();

      render(
        <OrderedEditableListWrapper
          itemType="text"
          initialItems={[
            { id: '1', value: 'A', label: 'First' },
            { id: '2', value: 'B', label: 'Second' },
            { id: '3', value: 'C', label: 'Third' },
          ]}
        />
      );

      const firstItem = screen.getByText('First').closest('li')!;
      const moveDownButton = firstItem.querySelector('button[aria-label="move down"]') as HTMLElement;
      await user.click(moveDownButton);

      // Order should now be: Second, First, Third
      const listItems = within(screen.getByRole('list')).getAllByRole('listitem');
      expect(within(listItems[0]).getByText('1.')).toBeInTheDocument();
      expect(within(listItems[0]).getByText('Second')).toBeInTheDocument();
      expect(within(listItems[1]).getByText('2.')).toBeInTheDocument();
      expect(within(listItems[1]).getByText('First')).toBeInTheDocument();
      expect(within(listItems[2]).getByText('3.')).toBeInTheDocument();
      expect(within(listItems[2]).getByText('Third')).toBeInTheDocument();
    });

    it('moves an item up when clicking move up button', async () => {
      const user = userEvent.setup();

      render(
        <OrderedEditableListWrapper
          itemType="text"
          initialItems={[
            { id: '1', value: 'A', label: 'First' },
            { id: '2', value: 'B', label: 'Second' },
            { id: '3', value: 'C', label: 'Third' },
          ]}
        />
      );

      const thirdItem = screen.getByText('Third').closest('li')!;
      const moveUpButton = thirdItem.querySelector('button[aria-label="move up"]') as HTMLElement;
      await user.click(moveUpButton);

      // Order should now be: First, Third, Second
      const listItems = within(screen.getByRole('list')).getAllByRole('listitem');
      expect(within(listItems[0]).getByText('1.')).toBeInTheDocument();
      expect(within(listItems[0]).getByText('First')).toBeInTheDocument();
      expect(within(listItems[1]).getByText('2.')).toBeInTheDocument();
      expect(within(listItems[1]).getByText('Third')).toBeInTheDocument();
      expect(within(listItems[2]).getByText('3.')).toBeInTheDocument();
      expect(within(listItems[2]).getByText('Second')).toBeInTheDocument();
    });
  });

  describe('File and Image', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('renders file items as download links', () => {
      render(
        <OrderedEditableListWrapper
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
        <OrderedEditableListWrapper
          itemType="file"
          fileVariant="image"
          initialItems={[
            { id: '1', value: '/uploads/photo.png', label: 'photo.png' },
          ]}
        />
      );

      const link = screen.getByRole('link', { name: 'photo.png' });
      expect(link).toHaveAttribute('href', '/uploads/photo.png');
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/uploads/photo.png');
      expect(img).toHaveAttribute('alt', 'photo.png');
    });

    it('uploads a file and adds it to the list', async () => {
      const user = userEvent.setup();
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'att-1', name: 'test-file.pdf' }),
      } as Response);

      render(
        <OrderedEditableListWrapper
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
      // The list shows the file from its authorized route, keyed by the attachment id the upload answered with.
      expect(link).toHaveAttribute('href', '/api/attachments/att-1');
    });

    it('shows error when upload fails', async () => {
      const user = userEvent.setup();
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'File too large' }),
      } as Response);

      render(
        <OrderedEditableListWrapper
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

  it('links a row that carries an href to its record, and leaves the others as text', () => {
    render(
      <OrderedEditableListWrapper
        itemType="text"
        initialItems={[
          { id: '1', value: 'One', label: 'Item One', href: '/thing/view/1', order: 1 },
          { id: '2', value: 'Two', label: 'Item Two', order: 2 },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'Item One' })).toHaveAttribute('href', '/thing/view/1');
    expect(screen.queryByRole('link', { name: 'Item Two' })).not.toBeInTheDocument();
    expect(screen.getByText('Item Two')).toBeInTheDocument();
  });

  // Issue #1411: several items can be added from one Add dialog.
  describe('Adding several items in one go', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('adds several autocomplete options picked in one dialog', async () => {
      const user = userEvent.setup();
      render(
        <OrderedEditableListWrapper
          itemType="autocomplete"
          allAutocompleteOptions={[
            { id: '1', label: 'Alpha' },
            { id: '2', label: 'Beta' },
            { id: '3', label: 'Gamma' },
          ]}
        />
      );

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const combo = within(addDialog).getByLabelText(/select/i);
      await user.click(combo);
      await user.click(screen.getByRole('option', { name: 'Alpha' }));
      await user.click(combo);
      // An option already picked in this dialog is not offered again.
      expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'Gamma' }));
      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
      });
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
      expect(rows).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('Gamma')]);
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });

    it('adds nothing when one picked option fails validation', async () => {
      const user = userEvent.setup();
      render(
        <OrderedEditableListWrapper
          itemType="autocomplete"
          allAutocompleteOptions={[
            { id: '1', label: 'Alpha' },
            { id: '2', label: 'Beta' },
          ]}
          validateItem={(v) => (v === '2' ? 'Not allowed' : null)}
        />
      );

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const combo = within(addDialog).getByLabelText(/select/i);
      await user.click(combo);
      await user.click(screen.getByRole('option', { name: 'Alpha' }));
      await user.click(combo);
      await user.click(screen.getByRole('option', { name: 'Beta' }));
      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      expect(await within(addDialog).findByText('Beta: Not allowed')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: /add items/i })).toBeInTheDocument();
      expect(screen.getByText('No items yet')).toBeInTheDocument();
    });

    it('uploads several files chosen in one dialog', async () => {
      const user = userEvent.setup();
      let n = 0;
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        n += 1;
        return { ok: true, json: () => Promise.resolve({ id: `att-${n}` }) } as Response;
      });

      render(<OrderedEditableListWrapper itemType="file" fileVariant="file" initialItems={[]} />);

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const fileInput = addDialog.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toHaveAttribute('multiple');

      const a = new File(['a'], 'a.pdf', { type: 'application/pdf' });
      const b = new File(['bb'], 'b.pdf', { type: 'application/pdf' });
      const c = new File(['ccc'], 'c.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [a, b] } });
      // A second pick adds to the selection instead of replacing it; a duplicate is ignored.
      fireEvent.change(fileInput, { target: { files: [b, c] } });
      // A file can be dropped from the selection before uploading.
      await user.click(within(addDialog).getByRole('button', { name: 'Remove b.pdf' }));

      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /add items/i })).not.toBeInTheDocument();
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('link', { name: 'a.pdf' })).toHaveAttribute('href', '/api/attachments/att-1');
      expect(screen.getByRole('link', { name: 'c.pdf' })).toHaveAttribute('href', '/api/attachments/att-2');
      expect(screen.queryByRole('link', { name: 'b.pdf' })).not.toBeInTheDocument();
    });

    it('keeps the uploaded files and leaves only the failed one selected when one upload fails', async () => {
      const user = userEvent.setup();
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
        const file = (init?.body as FormData).get('file') as File;
        if (file.name === 'bad.pdf') {
          return { ok: false, json: () => Promise.resolve({ error: 'rate_limited' }) } as Response;
        }
        return { ok: true, json: () => Promise.resolve({ id: `att-${file.name}` }) } as Response;
      });

      render(<OrderedEditableListWrapper itemType="file" fileVariant="file" initialItems={[]} />);

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const fileInput = addDialog.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: {
          files: [
            new File(['1'], 'good.pdf', { type: 'application/pdf' }),
            new File(['2'], 'bad.pdf', { type: 'application/pdf' }),
          ],
        },
      });
      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      expect(await within(addDialog).findByText('bad.pdf: rate_limited')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'good.pdf', hidden: true })).toHaveAttribute('href', '/api/attachments/att-good.pdf');
      expect(within(addDialog).getByRole('button', { name: 'Remove bad.pdf' })).toBeInTheDocument();
      expect(within(addDialog).queryByRole('button', { name: 'Remove good.pdf' })).not.toBeInTheDocument();
    });

    it('refuses the whole batch without uploading when a file is too large', async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(global, 'fetch');

      render(<OrderedEditableListWrapper itemType="file" fileVariant="file" maxFileSize={1024 * 1024} />);

      await user.click(screen.getByRole('button', { name: /add item/i }));
      const addDialog = screen.getByRole('dialog', { name: /add items/i });
      const fileInput = addDialog.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: {
          files: [
            new File(['x'], 'small.pdf', { type: 'application/pdf' }),
            new File([new Uint8Array(2 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' }),
          ],
        },
      });
      await user.click(within(addDialog).getByRole('button', { name: /add/i }));

      expect(await within(addDialog).findByText('huge.pdf: File size must be less than 1MB')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByText('No items yet')).toBeInTheDocument();
    });
  });
});
