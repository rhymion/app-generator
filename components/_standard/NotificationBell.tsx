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

// Production doesn't need sub-minute freshness (notifications aren't
// urgent) but Cypress e2e specs assert the bell updates within seconds of
// the triggering action, so the interval is env-configurable rather than a
// single hardcoded value. `NEXT_PUBLIC_` is required for a value read in
// client-side code — Next.js inlines it at build time, so `.env.test` sets
// it short for the e2e build and the shared `.env` baseline sets it long
// for everything else.
const DEFAULT_POLL_INTERVAL_MS = 180_000; // 3 minutes

function pollIntervalMs(): number {
  const raw = process.env.NEXT_PUBLIC_NOTIFICATION_POLL_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

/**
 * Bell button backed by `GET /api/notifications` (DB-backed, correct
 * regardless of which server instance/process handled the write — see the
 * module doc in `lib/_notifier.ts`). There is no push/SSE path: this repo
 * previously used an EventEmitter-backed SSE stream for instant same-process
 * delivery, but that mechanism silently does nothing across server
 * instances/processes (e.g. serverless), which is worse than not having it.
 * Polling is the sole correctness mechanism, refreshed via:
 *   - a recurring interval (`pollIntervalMs()`),
 *   - once on mount,
 *   - every time the bell is opened,
 *   - whenever the tab regains focus/visibility (covers "switched from
 *     another browser/tab back to this one").
 */
export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const cancelledRef = useRef(false);

  const fetchSnapshot = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok || cancelledRef.current) return null;
      const data = (await res.json()) as Snapshot;
      if (cancelledRef.current) return null;
      setItems(data.items);
      setUnread(data.unread);
      return data;
    } catch {
      // Best-effort. The next poll tick / trigger reconciles.
      return null;
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    // Deferred via setTimeout(…, 0) rather than called directly in the
    // effect body — same pattern as EntityAutocomplete.tsx's search effect.
    // Calling a setState-triggering function synchronously in an effect
    // body causes cascading renders; scheduling it as a timer callback
    // keeps the initial fetch async without that footgun.
    const initialFetchId = window.setTimeout(() => {
      void fetchSnapshot();
    }, 0);

    const intervalId = window.setInterval(() => {
      void fetchSnapshot();
    }, pollIntervalMs());

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      void fetchSnapshot();
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      cancelledRef.current = true;
      window.clearTimeout(initialFetchId);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [fetchSnapshot]);

  const handleOpen = useCallback(async (event: React.MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget);
    // Opening the bell is one of the immediacy triggers — refetch so the
    // dropdown shows anything written since the last poll tick.
    const snapshot = await fetchSnapshot();
    // Opening the bell also counts as "seen" — mark everything read on the
    // server and optimistically update the badge.
    if (snapshot && snapshot.unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      fetch('/api/notifications/mark-read', { method: 'POST' }).catch(() => {
        // Best-effort. The next poll reconciles.
      });
    }
  }, [fetchSnapshot]);

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
                slotProps={{ primary: { sx: { fontWeight: item.read ? 400 : 600 } } }}
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
