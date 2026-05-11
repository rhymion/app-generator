'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import NotificationsIcon from '@mui/icons-material/Notifications';

interface NotificationItem {
  id: string;
  type: string;
  payload: { title: string; href?: string; [key: string]: unknown };
  createdAt: number;
  read: boolean;
}

interface Snapshot {
  items: NotificationItem[];
  unread: number;
}

const RECONNECT_BACKOFF_MS = 3_000;

/**
 * Bell button that subscribes to /api/notifications/stream via SSE. The server
 * pushes one `snapshot` event on connect and one `notification` event per
 * `notify()` call thereafter — no client-side polling. Closes and re-opens
 * the EventSource on transient network failure with a short backoff so the
 * bell heals itself after a server restart.
 */
export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    function connect() {
      if (cancelledRef.current) return;
      const es = new EventSource('/api/notifications/stream');
      esRef.current = es;

      es.addEventListener('snapshot', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as Snapshot;
        setItems(data.items);
        setUnread(data.unread);
      });

      es.addEventListener('notification', (event) => {
        const entry = JSON.parse((event as MessageEvent).data) as NotificationItem;
        setItems((prev) => [entry, ...prev].slice(0, 50));
        setUnread((prev) => prev + 1);
      });

      es.onerror = () => {
        es.close();
        if (cancelledRef.current) return;
        reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_BACKOFF_MS);
      };
    }

    connect();

    return () => {
      cancelledRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      esRef.current?.close();
    };
  }, []);

  const handleOpen = useCallback(async (event: React.MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget);
    // Opening the bell counts as "seen" — mark everything read on the server
    // and optimistically update the badge.
    if (unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      try {
        await fetch('/api/notifications/mark-read', { method: 'POST' });
      } catch {
        // Best-effort. The next snapshot on reconnect will reconcile.
      }
    }
  }, [unread]);

  const handleClose = useCallback(() => setAnchor(null), []);

  return (
    <>
      <IconButton
        onClick={handleOpen}
        aria-label="Notifications"
        sx={{ color: 'white' }}
      >
        <Badge badgeContent={unread} color="error" max={99}>
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth: 320, maxWidth: 420 } } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {items.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="No notifications" />
          </MenuItem>
        ) : (
          items.map((item, idx) => {
            const inner = (
              <ListItemText
                primary={item.payload.title}
                secondary={new Date(item.createdAt).toLocaleString()}
                primaryTypographyProps={{ fontWeight: item.read ? 400 : 600 }}
              />
            );
            return (
              <div key={item.id}>
                {idx > 0 && <Divider component="li" />}
                {item.payload.href ? (
                  <MenuItem component="a" href={item.payload.href} onClick={handleClose}>
                    {inner}
                  </MenuItem>
                ) : (
                  <MenuItem disableRipple sx={{ cursor: 'default' }}>
                    {inner}
                  </MenuItem>
                )}
              </div>
            );
          })
        )}
      </Menu>
    </>
  );
}
