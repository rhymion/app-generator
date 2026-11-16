import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AppFieldText from './AppFieldText';

describe('AppFieldText read-only display (x-ui.rows on detail pages)', () => {
  it('renders a single-line input by default', () => {
    const { container } = render(<AppFieldText label="Name" value="Alice" readOnly />);
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.getByDisplayValue('Alice').tagName).toBe('INPUT');
  });

  it('renders a multi-line textarea with the given rows when multiline is set', () => {
    render(<AppFieldText label="Notes" value={'line 1\nline 2'} multiline rows={6} readOnly />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '6');
  });

  it('keeps the multi-line editable input behaviour unchanged', () => {
    render(<AppFieldText label="Notes" defaultValue="x" multiline rows={3} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '3');
  });
});
