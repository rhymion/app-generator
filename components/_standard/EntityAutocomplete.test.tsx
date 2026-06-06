import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EntityAutocomplete from './EntityAutocomplete';
import type { EntityOption } from './EntityAutocomplete';

const optionA: EntityOption = { id: 'a1', label: 'Alpha' };
const optionB: EntityOption = { id: 'b2', label: 'Beta' };

describe('EntityAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders text field with given label', () => {
    const searchAction = vi.fn().mockResolvedValue([]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value={null}
        onChange={vi.fn()}
        searchAction={searchAction}
      />
    );
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
  });

  it('shows initialOptions in dropdown when openOnFocus=true and focused', async () => {
    const searchAction = vi.fn().mockResolvedValue([]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value={null}
        onChange={vi.fn()}
        searchAction={searchAction}
        initialOptions={[optionA, optionB]}
        openOnFocus
      />
    );
    const input = screen.getByLabelText('Assignee');
    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('calls searchAction after debounce delay when user types', async () => {
    const searchAction = vi.fn().mockResolvedValue([optionA]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value={null}
        onChange={vi.fn()}
        searchAction={searchAction}
        debounceMs={50}
      />
    );
    const input = screen.getByLabelText('Assignee');
    fireEvent.change(input, { target: { value: 'al' } });
    // Simulate the internal input change by firing the input event
    fireEvent.input(input, { target: { value: 'al' } });
    await waitFor(
      () => {
        expect(searchAction).toHaveBeenCalledWith('al', []);
      },
      { timeout: 500 }
    );
  }, 3000);

  it('includes current value in searchAction includeIds when value is set', async () => {
    const searchAction = vi.fn().mockResolvedValue([optionA]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value="a1"
        onChange={vi.fn()}
        searchAction={searchAction}
        currentOption={optionA}
        debounceMs={50}
      />
    );
    const input = screen.getByLabelText('Assignee');
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.input(input, { target: { value: 'al' } });
    await waitFor(
      () => {
        expect(searchAction).toHaveBeenCalledWith('al', ['a1']);
      },
      { timeout: 500 }
    );
  }, 3000);

  it('is disabled when disabled prop is true', () => {
    const searchAction = vi.fn().mockResolvedValue([]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value={null}
        onChange={vi.fn()}
        searchAction={searchAction}
        disabled
      />
    );
    expect(screen.getByLabelText('Assignee')).toBeDisabled();
  });

  it('renders required attribute when required=true', () => {
    const searchAction = vi.fn().mockResolvedValue([]);
    render(
      <EntityAutocomplete
        label="Assignee"
        value={null}
        onChange={vi.fn()}
        searchAction={searchAction}
        required
      />
    );
    expect(screen.getByLabelText(/Assignee/)).toBeRequired();
  });
});
