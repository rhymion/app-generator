import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import NotificationBell from './NotificationBell';

type ESListener = (event: MessageEvent) => void;
type ESErrorListener = (event: Event) => void;

class MockEventSource {
  static instance: MockEventSource | null = null;
  listeners: Record<string, ESListener[]> = {};
  onerror: ESErrorListener | null = null;
  closed = false;

  constructor(_url: string) {
    MockEventSource.instance = this;
  }

  addEventListener(type: string, listener: ESListener) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(listener);
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners[type] ?? []).forEach((fn) => fn(event));
  }

  close() {
    this.closed = true;
  }
}

describe('NotificationBell', () => {
  beforeEach(() => {
    MockEventSource.instance = null;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders notification bell icon button', () => {
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('connects to SSE stream on mount', () => {
    render(<NotificationBell />);
    expect(MockEventSource.instance).not.toBeNull();
  });

  it('shows unread badge count from snapshot event', async () => {
    render(<NotificationBell />);
    act(() => {
      MockEventSource.instance!.emit('snapshot', {
        items: [
          { id: 'n1', type: 'info', payload: { title: 'Hello' }, createdAt: Date.now(), read: false },
        ],
        unread: 1,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('increments badge on new notification event', async () => {
    render(<NotificationBell />);
    act(() => {
      MockEventSource.instance!.emit('snapshot', { items: [], unread: 0 });
    });
    act(() => {
      MockEventSource.instance!.emit('notification', {
        id: 'n1',
        type: 'info',
        payload: { title: 'New task assigned' },
        createdAt: Date.now(),
        read: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('opens notification menu when bell is clicked', async () => {
    render(<NotificationBell />);
    act(() => {
      MockEventSource.instance!.emit('snapshot', { items: [], unread: 0 });
    });
    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('shows notification items in menu', async () => {
    render(<NotificationBell />);
    act(() => {
      MockEventSource.instance!.emit('snapshot', {
        items: [
          { id: 'n1', type: 'info', payload: { title: 'Task ready' }, createdAt: Date.now(), read: false },
        ],
        unread: 1,
      });
    });
    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('Task ready')).toBeInTheDocument();
    });
  });

  it('calls mark-read API when opening menu with unread items', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    render(<NotificationBell />);
    act(() => {
      MockEventSource.instance!.emit('snapshot', { items: [], unread: 3 });
    });
    await waitFor(() => screen.getByText('3'));

    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/notifications/mark-read',
        { method: 'POST' }
      );
    });
  });

  it('closes SSE connection on unmount', () => {
    const { unmount } = render(<NotificationBell />);
    const es = MockEventSource.instance!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
