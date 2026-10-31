import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getApiKeyStatus, issueApiKey } = vi.hoisted(() => ({
  getApiKeyStatus: vi.fn(),
  issueApiKey: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
}));
vi.mock('@/lib/setting/api-key-actions', () => ({ getApiKeyStatus, issueApiKey }));

import ApiKeyPanel from './ApiKeyPanel';

// The panel sits in a collapsed section, as the password section does.
const expand = () => fireEvent.click(screen.getByRole('button', { name: 'title' }));

const NEW_KEY = 'mk_' + 'b'.repeat(64);

beforeEach(() => {
  getApiKeyStatus.mockReset();
  issueApiKey.mockReset();
});

describe('ApiKeyPanel', () => {
  it('shows only that a key is set, never a key value', async () => {
    getApiKeyStatus.mockResolvedValue({ isSet: true, issuedAt: '2026-10-31T00:00:00.000Z', expiresAt: null });
    const { container } = render(<ApiKeyPanel />);
    expand();

    await waitFor(() => expect(screen.getByText(/statusSetIssued/)).toBeInTheDocument());
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByRole('button', { name: 'reissue' })).toBeInTheDocument();
  });

  it('offers to issue a first key when none is set', async () => {
    getApiKeyStatus.mockResolvedValue({ isSet: false, issuedAt: null, expiresAt: null });
    render(<ApiKeyPanel />);
    expand();

    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'issue' })).toBeInTheDocument();
  });

  it('shows the new key once, in the response to issuing it, with a note that it is not shown again', async () => {
    getApiKeyStatus.mockResolvedValue({ isSet: false, issuedAt: null, expiresAt: null });
    issueApiKey.mockResolvedValue({
      apiKey: NEW_KEY,
      status: { isSet: true, issuedAt: '2026-10-31T01:00:00.000Z', expiresAt: null },
    });
    const { container, unmount } = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));

    await waitFor(() => expect(screen.getByText('shownOnce')).toBeInTheDocument());
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(NEW_KEY);

    unmount();
    getApiKeyStatus.mockResolvedValue({ isSet: true, issuedAt: '2026-10-31T01:00:00.000Z', expiresAt: null });
    const again = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText(/statusSetIssued/)).toBeInTheDocument());
    expect(again.container.querySelector('input')).toBeNull();
    expect(again.container.textContent).not.toContain(NEW_KEY);
  });

  it('shows an error when issuing fails and keeps no key on screen', async () => {
    getApiKeyStatus.mockResolvedValue({ isSet: false, issuedAt: null, expiresAt: null });
    issueApiKey.mockRejectedValue(new Error('boom'));
    const { container } = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));

    await waitFor(() => expect(screen.getByText('issueFailed')).toBeInTheDocument());
    expect(container.querySelector('input')).toBeNull();
  });
});
