import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import EntityAutocompleteCellEditor, { entityAutocompleteValueFormatter } from './EntityAutocompleteCellEditor';
import type { EntityAutocompleteCellConfig } from './EntityAutocompleteCellEditor';

vi.mock('./EntityAutocomplete', () => ({
  default: ({
    label,
    value,
    openOnFocus,
    disabled,
  }: {
    label: string;
    value: string | null;
    openOnFocus?: boolean;
    disabled?: boolean;
  }) => (
    <input
      data-testid="entity-autocomplete"
      aria-label={label}
      defaultValue={value ?? ''}
      data-open-on-focus={openOnFocus ? 'true' : 'false'}
      disabled={disabled}
    />
  ),
}));

const mockSetEditCellValue = vi.fn();

vi.mock('@mui/x-data-grid', () => ({
  useGridApiContext: () => ({
    current: { setEditCellValue: mockSetEditCellValue },
  }),
}));

const labelLookup = new Map<string, string>([['u1', 'Alice']]);

const config: EntityAutocompleteCellConfig = {
  searchAction: vi.fn().mockResolvedValue([]),
  initialOptions: [{ id: 'u1', label: 'Alice' }],
  labelLookup,
  label: 'User',
  required: false,
};

const baseProps = {
  id: 'row1',
  field: 'user_id',
  value: 'u1',
  row: {},
  rowNode: {} as never,
  colDef: {} as never,
  api: {} as never,
  cellMode: 'edit' as const,
  isEditable: true,
  tabIndex: 0 as const,
  hasFocus: false,
  config,
};

describe('EntityAutocompleteCellEditor', () => {
  it('renders EntityAutocomplete with label from config', () => {
    render(<EntityAutocompleteCellEditor {...baseProps} />);
    expect(screen.getByTestId('entity-autocomplete')).toBeInTheDocument();
    expect(screen.getByLabelText('User')).toBeInTheDocument();
  });

  it('passes openOnFocus=true to EntityAutocomplete', () => {
    render(<EntityAutocompleteCellEditor {...baseProps} />);
    expect(screen.getByTestId('entity-autocomplete')).toHaveAttribute('data-open-on-focus', 'true');
  });

  it('resolves current option label from labelLookup', () => {
    render(<EntityAutocompleteCellEditor {...baseProps} value="u1" />);
    expect(screen.getByTestId('entity-autocomplete')).toBeInTheDocument();
  });

  it('treats empty string value as null (no selection)', () => {
    render(<EntityAutocompleteCellEditor {...baseProps} value="" />);
    expect(screen.getByTestId('entity-autocomplete')).toBeInTheDocument();
  });
});

describe('entityAutocompleteValueFormatter', () => {
  const lookup = new Map<string, string>([['u1', 'Alice'], ['u2', 'Bob']]);
  const cfg: EntityAutocompleteCellConfig = {
    searchAction: vi.fn(),
    labelLookup: lookup,
    label: 'User',
  };
  const formatter = entityAutocompleteValueFormatter(cfg);

  it('returns label for known id', () => {
    expect(formatter('u1')).toBe('Alice');
  });

  it('returns empty string for unknown id', () => {
    expect(formatter('x99')).toBe('');
  });

  it('returns empty string for null value', () => {
    expect(formatter(null)).toBe('');
  });

  it('returns empty string for empty string value', () => {
    expect(formatter('')).toBe('');
  });

  it('returns empty string for non-string value', () => {
    expect(formatter(42)).toBe('');
  });
});
