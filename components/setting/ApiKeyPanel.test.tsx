import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getApiKeyStatus, issueApiKey, setApiKeyExpiry } = vi.hoisted(() => ({
  getApiKeyStatus: vi.fn(),
  issueApiKey: vi.fn(),
  setApiKeyExpiry: vi.fn(),
}));

// One function for every call, as next-intl returns a stable `t`; the panel loads its status in an effect keyed on it.
const translate = (key: string, values?: Record<string, string>) =>
  values ? `${key} ${Object.values(values).join(' ')}` : key;
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/setting/api-key-actions', () => ({ getApiKeyStatus, issueApiKey, setApiKeyExpiry }));

import ApiKeyPanel from './ApiKeyPanel';

// The panel sits in a collapsed section, as the password section does.
const expand = () => fireEvent.click(screen.getByRole('button', { name: 'title' }));

const st = (over: Record<string, unknown> = {}) => ({
  isSet: false,
  issuedAt: null,
  expiresAt: null,
  expired: false,
  defaultExpiryDays: 90,
  ...over,
});

// The key itself is the only text input with a readonly flag; expiry inputs are datetime-local.
const keyInput = (c: HTMLElement) => c.querySelector('input[readonly]') as HTMLInputElement | null;

const NEW_KEY = 'mk_' + 'b'.repeat(64);

beforeEach(() => {
  getApiKeyStatus.mockReset();
  issueApiKey.mockReset();
  setApiKeyExpiry.mockReset();
});

describe('ApiKeyPanel', () => {
  it('shows only that a key is set, never a key value', async () => {
    getApiKeyStatus.mockResolvedValue(st({ isSet: true, issuedAt: '2026-10-31T00:00:00.000Z' }));
    const { container } = render(<ApiKeyPanel />);
    expand();

    await waitFor(() => expect(screen.getByText(/statusSetIssued/)).toBeInTheDocument());
    expect(keyInput(container)).toBeNull();
    expect(screen.getByRole('button', { name: 'reissue' })).toBeInTheDocument();
  });

  it('offers to issue a first key when none is set', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    render(<ApiKeyPanel />);
    expand();

    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'issue' })).toBeInTheDocument();
  });

  it('shows the new key once, in the response to issuing it, with a note that it is not shown again', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    issueApiKey.mockResolvedValue({
      apiKey: NEW_KEY,
      status: st({ isSet: true, issuedAt: '2026-10-31T01:00:00.000Z' }),
    });
    const { container, unmount } = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));

    await waitFor(() => expect(screen.getByText('shownOnce')).toBeInTheDocument());
    expect(keyInput(container)!.value).toBe(NEW_KEY);

    unmount();
    getApiKeyStatus.mockResolvedValue(st({ isSet: true, issuedAt: '2026-10-31T01:00:00.000Z' }));
    const again = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText(/statusSetIssued/)).toBeInTheDocument());
    expect(keyInput(again.container)).toBeNull();
    expect(again.container.textContent).not.toContain(NEW_KEY);
  });

  it('shows an error when issuing fails and keeps no key on screen', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    issueApiKey.mockRejectedValue(new Error('boom'));
    const { container } = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));

    await waitFor(() => expect(screen.getByText('issueFailed')).toBeInTheDocument());
    expect(keyInput(container)).toBeNull();
  });

  it('preselects the site default expiry for a new key and sends it with the request', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    issueApiKey.mockResolvedValue({ apiKey: NEW_KEY, status: st({ isSet: true }) });
    render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    const input = screen.getByTestId('api-key-issue-expiry') as HTMLInputElement;
    const days = (new Date(input.value).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));
    await waitFor(() => expect(issueApiKey).toHaveBeenCalled());
    expect(typeof issueApiKey.mock.calls[0][0].expiresAt).toBe('string');
  });

  it('starts at "never expires" when the site default is none, and lets the owner choose a date instead', async () => {
    getApiKeyStatus.mockResolvedValue(st({ defaultExpiryDays: null }));
    issueApiKey.mockResolvedValue({ apiKey: NEW_KEY, status: st({ isSet: true }) });
    render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());
    expect(screen.queryByTestId('api-key-issue-expiry')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'issue' }));
    await waitFor(() => expect(issueApiKey).toHaveBeenCalledWith({ expiresAt: null }));
  });

  it('refuses a past expiry on the client without calling the server', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('api-key-issue-expiry'), { target: { value: '2001-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'issue' }));

    expect(await screen.findByText('expiryInvalid')).toBeInTheDocument();
    expect(issueApiKey).not.toHaveBeenCalled();
  });

  it('shows the current expiry, marks an elapsed one, and says when there is none', async () => {
    getApiKeyStatus.mockResolvedValue(st({ isSet: true, expiresAt: '2030-01-01T00:00:00.000Z' }));
    const first = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(first.container.textContent).toContain('expires'));
    first.unmount();

    getApiKeyStatus.mockResolvedValue(st({ isSet: true, expiresAt: '2020-01-01T00:00:00.000Z', expired: true }));
    const second = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(second.container.textContent).toContain('expired'));
    second.unmount();

    getApiKeyStatus.mockResolvedValue(st({ isSet: true }));
    const third = render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(third.container.textContent).toContain('neverExpires'));
  });

  it('changes and clears the current key expiry through the server', async () => {
    getApiKeyStatus.mockResolvedValue(st({ isSet: true, expiresAt: '2030-01-01T00:00:00.000Z' }));
    setApiKeyExpiry.mockResolvedValue(st({ isSet: true }));
    render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByTestId('api-key-change-expiry')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('api-key-change-expiry'), { target: { value: '2031-02-03T04:05' } });
    fireEvent.click(screen.getByRole('button', { name: 'saveExpiry' }));
    await waitFor(() => expect(setApiKeyExpiry).toHaveBeenCalledTimes(1));
    expect(setApiKeyExpiry.mock.calls[0][0]).toBe(new Date('2031-02-03T04:05').toISOString());

    // After the save the status has no expiry, so the control is on "never expires": saving clears it.
    await waitFor(() => expect(screen.queryByTestId('api-key-change-expiry')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'saveExpiry' }));
    await waitFor(() => expect(setApiKeyExpiry).toHaveBeenLastCalledWith(null));
  });

  it('offers no expiry change while there is no key', async () => {
    getApiKeyStatus.mockResolvedValue(st());
    render(<ApiKeyPanel />);
    expand();
    await waitFor(() => expect(screen.getByText('statusNotSet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'saveExpiry' })).toBeNull();
  });
});
