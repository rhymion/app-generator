import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ListQueryPanel from './ListQueryPanel';
import { EMPTY_LIST_QUERY, type ListQuerySpec, type ListQueryState } from '@/lib/_list_query';
import { renderWithIntl } from '../../vitest/i18n';

const spec: ListQuerySpec = {
  fields: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'qty', label: 'Quantity', kind: 'number' },
    { key: 'status', label: 'Status', kind: 'enum', options: ['open', 'closed'], optionLabels: { open: 'Open' } },
    { key: 'active', label: 'Active', kind: 'boolean' },
    { key: 'created_at', label: 'Created', kind: 'date' },
  ],
  sortKeys: ['name', 'qty', 'status', 'created_at'],
  filterKeys: ['name', 'qty', 'status', 'active'],
  searchKey: 'name',
};

/** Holds the state like a list does, and reports every change it receives. */
function Harness({ onChange, panelSpec = spec }: { onChange: (next: ListQueryState) => void; panelSpec?: ListQuerySpec }) {
  const [value, setValue] = useState<ListQueryState>(EMPTY_LIST_QUERY);
  return (
    <ListQueryPanel
      spec={panelSpec}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('ListQueryPanel', () => {
  it('sorts by several columns in the order they are chosen', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await userEvent.click(screen.getByTestId('list-sort-name'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sort: [
          { field: 'qty', dir: 'desc' },
          { field: 'name', dir: 'asc' },
        ],
      }),
    );
    // The primary sort is on the button; the order of each column is on its chip.
    expect(screen.getByTestId('list-sort-toggle')).toHaveTextContent('Sort: Quantity ↓ +1');
    expect(screen.getByTestId('list-sort-qty')).toHaveTextContent('Quantity ↓ 1');
    expect(screen.getByTestId('list-sort-name')).toHaveTextContent('Name ↑ 2');
  });

  it('clears the sort', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await userEvent.click(screen.getByTestId('list-sort-clear'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: [] }));
    expect(screen.queryByTestId('list-sort-clear')).toBeNull();
  });

  it('filters several fields at once', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    await userEvent.type(screen.getByTestId('list-filter-name'), 'bolt');
    await userEvent.type(screen.getByTestId('list-filter-qty'), '5');
    await userEvent.click(screen.getByTestId('list-filter-status-open'));
    await userEvent.click(screen.getByTestId('list-filter-active-true'));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: { name: 'bolt', qty: '5', status: 'open', active: 'true' } }),
      ),
    );
    expect(screen.getByTestId('list-filter-toggle')).toHaveTextContent('Filter (4)');
  });

  it('offers a sort-only column in the sort panel but not in the filter panel', async () => {
    renderWithIntl(<Harness onChange={vi.fn()} />);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    expect(screen.getByTestId('list-sort-created_at')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    expect(screen.queryByTestId('list-filter-created_at')).toBeNull();
  });

  it('shows enum members by their label and toggles a choice off', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    expect(screen.getByTestId('list-filter-status-open')).toHaveTextContent('Open');
    expect(screen.getByTestId('list-filter-status-closed')).toHaveTextContent('closed');
    await userEvent.click(screen.getByTestId('list-filter-status-open'));
    await userEvent.click(screen.getByTestId('list-filter-status-open'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ filters: {} }));
  });

  it('clears every filter', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-filter-toggle'));
    await userEvent.click(screen.getByTestId('list-filter-active-false'));
    await userEvent.click(screen.getByTestId('list-filter-clear'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ filters: {} }));
    expect(screen.getByTestId('list-filter-toggle')).toHaveTextContent(/^Filter$/);
  });

  it('holds typing back until it pauses, then reports the search once', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByTestId('list-search'), 'nut');
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'nut' }));
  });

  it('keeps the sort when a search is typed', async () => {
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByTestId('list-sort-toggle'));
    await userEvent.click(screen.getByTestId('list-sort-qty'));
    await userEvent.type(screen.getByTestId('list-search'), 'a');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ search: 'a', sort: [{ field: 'qty', dir: 'asc' }], filters: {} }));
  });

  it('omits the controls the entity does not offer', () => {
    renderWithIntl(<Harness onChange={vi.fn()} panelSpec={{ fields: [], sortKeys: [], filterKeys: [], searchKey: null }} />);
    expect(screen.queryByTestId('list-search')).toBeNull();
    expect(screen.queryByTestId('list-sort-toggle')).toBeNull();
    expect(screen.queryByTestId('list-filter-toggle')).toBeNull();
  });
});
