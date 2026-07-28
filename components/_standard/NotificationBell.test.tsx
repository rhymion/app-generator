import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import NotificationBell from './NotificationBell';

function snapshotResponse(body: { items: unknown[]; unread: number }) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe('NotificationBell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders notification bell icon button', () => {
    const fetchMock = vi.fn().mockReturnValue(snapshotResponse({ items: [], unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('fetches /api/notifications once on mount', async () => {
    const fetchMock = vi.fn().mockReturnValue(snapshotResponse({ items: [], unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/notifications'));
  });

  it('shows unread badge count from the mount fetch', async () => {
    const fetchMock = vi.fn().mockReturnValue(
      snapshotResponse({
        items: [{ id: 'n1', type: 'info', payload: { title: 'Hello' }, createdAt: Date.now(), read: false }],
        unread: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('refetches on the poll interval and reflects a newly arrived notification', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockReturnValueOnce(snapshotResponse({ items: [], unread: 0 }))
        .mockReturnValueOnce(snapshotResponse({
          items: [{ id: 'n1', type: 'info', payload: { title: 'New task assigned' }, createdAt: Date.now(), read: false }],
          unread: 1,
        }));
      vi.stubGlobal('fetch', fetchMock);
      render(<NotificationBell />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Default poll interval is 3 minutes (no NEXT_PUBLIC_NOTIFICATION_POLL_INTERVAL_MS in the unit test env).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('1')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches when the window regains focus', async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(snapshotResponse({ items: [], unread: 0 }))
      .mockReturnValueOnce(snapshotResponse({ items: [], unread: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('refetches when the tab becomes visible again', async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(snapshotResponse({ items: [], unread: 0 }))
      .mockReturnValueOnce(snapshotResponse({ items: [], unread: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  it('does not refetch on visibilitychange while the tab is hidden', async () => {
    const fetchMock = vi.fn().mockReturnValue(snapshotResponse({ items: [], unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens notification menu when bell is clicked, refetching first', async () => {
    const fetchMock = vi.fn().mockReturnValue(snapshotResponse({ items: [], unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('shows notification items in menu', async () => {
    const fetchMock = vi.fn().mockReturnValue(
      snapshotResponse({
        items: [{ id: 'n1', type: 'info', payload: { title: 'Task ready' }, createdAt: Date.now(), read: false }],
        unread: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('Task ready')).toBeInTheDocument();
    });
  });

  it('calls mark-read API when opening menu with unread items', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/notifications/mark-read') return Promise.resolve({ ok: true } as Response);
      return snapshotResponse({ items: [], unread: 3 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);
    await waitFor(() => screen.getByText('3'));

    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications/mark-read', { method: 'POST' });
    });
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockReturnValue(snapshotResponse({ items: [], unread: 0 }));
      vi.stubGlobal('fetch', fetchMock);
      const { unmount } = render(<NotificationBell />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
