import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CspNonceProvider, useCspNonce } from './CspNonceProvider';

function ShowNonce() {
  const nonce = useCspNonce();
  return <span data-testid="nonce">{nonce ?? '(none)'}</span>;
}

describe('CspNonceProvider', () => {
  it('gives the nonce to client components', () => {
    render(
      <CspNonceProvider nonce="abc123">
        <ShowNonce />
      </CspNonceProvider>
    );
    expect(screen.getByTestId('nonce')).toHaveTextContent('abc123');
  });

  it('returns undefined outside a provider', () => {
    render(<ShowNonce />);
    expect(screen.getByTestId('nonce')).toHaveTextContent('(none)');
  });

  it('returns undefined when the layout has no nonce (proxy did not run)', () => {
    render(
      <CspNonceProvider nonce={undefined}>
        <ShowNonce />
      </CspNonceProvider>
    );
    expect(screen.getByTestId('nonce')).toHaveTextContent('(none)');
  });

  it('keeps the first nonce when a server re-render passes a new one', () => {
    // The document's policy was fixed at the first load; a refreshed nonce would not match it.
    const { rerender } = render(
      <CspNonceProvider nonce="first">
        <ShowNonce />
      </CspNonceProvider>
    );
    rerender(
      <CspNonceProvider nonce="second">
        <ShowNonce />
      </CspNonceProvider>
    );
    expect(screen.getByTestId('nonce')).toHaveTextContent('first');
  });
});
