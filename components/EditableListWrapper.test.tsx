import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
});
