import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import AppFieldRelation from './AppFieldRelation';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const baseProps = {
  label: 'Topic',
  value: null,
  onChange: vi.fn(),
  searchAction: vi.fn().mockResolvedValue([]),
};

describe('AppFieldRelation create-in-place control (x-create-inline)', () => {
  it('shows no create control by default', () => {
    render(<AppFieldRelation {...baseProps} />);
    expect(screen.queryByLabelText(/createNew/)).not.toBeInTheDocument();
  });

  it('shows a create control named after the field when onCreateNew is given', () => {
    render(<AppFieldRelation {...baseProps} onCreateNew={vi.fn()} />);
    expect(screen.getByLabelText('createNew Topic')).toBeInTheDocument();
  });

  it('calls onCreateNew when the control is clicked', () => {
    const onCreateNew = vi.fn();
    render(<AppFieldRelation {...baseProps} onCreateNew={onCreateNew} />);
    fireEvent.click(screen.getByLabelText('createNew Topic'));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('shows the created notice only when one is given', () => {
    const { rerender } = render(<AppFieldRelation {...baseProps} onCreateNew={vi.fn()} />);
    expect(screen.queryByText('A topic was created')).not.toBeInTheDocument();
    rerender(<AppFieldRelation {...baseProps} onCreateNew={vi.fn()} createdNotice="A topic was created" />);
    expect(screen.getByText('A topic was created')).toBeInTheDocument();
  });

  it('offers no create control when the user cannot read the target (permissionDenied)', () => {
    render(<AppFieldRelation {...baseProps} permissionDenied onCreateNew={vi.fn()} />);
    expect(screen.queryByLabelText('createNew Topic')).not.toBeInTheDocument();
  });
});
