import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InlineCreateProvider, useInlineCreate } from './InlineCreate';

function Probe() {
  const inline = useInlineCreate();
  return <span data-testid="probe">{inline ? 'in-dialog' : 'own-page'}</span>;
}

describe('InlineCreate context', () => {
  it('is null when a form is shown on its own page', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('own-page');
  });

  it('carries the dialog callbacks to a form shown inside the provider', () => {
    const value = { onCreated: vi.fn(), onCancel: vi.fn() };
    function Reader() {
      const inline = useInlineCreate();
      inline?.onCreated('new-id');
      inline?.onCancel();
      return <Probe />;
    }
    render(
      <InlineCreateProvider value={value}>
        <Reader />
      </InlineCreateProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('in-dialog');
    expect(value.onCreated).toHaveBeenCalledWith('new-id');
    expect(value.onCancel).toHaveBeenCalledTimes(1);
  });
});
