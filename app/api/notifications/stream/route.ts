import type { NextRequest } from 'next/server';
import { getSessionUserId } from '@/lib/authz';
import {
  listNotifications,
  subscribe,
  unreadCount,
  type Notification,
} from '@/lib/_notifier';

/**
 * GET /api/notifications/stream — Server-Sent Events feed for the bell.
 *
 * The server holds the connection open and emits one event per call to
 * `notify(userId, …)` for the authenticated user. The client (the bell)
 * subscribes via `new EventSource('/api/notifications/stream')` and renders
 * each event as it arrives — no client-side polling.
 *
 * Wire format:
 *   - One `event: snapshot` on connect with the current inbox so the bell
 *     can render immediately (count badge + dropdown contents).
 *   - One `event: notification` per subsequent notify() call.
 *   - One `: keepalive` comment line every 25 s so intermediate proxies and
 *     the browser don't close an idle stream.
 *
 * Notes:
 *   - `runtime = 'nodejs'`: SSE needs a long-lived response, which the Edge
 *     runtime doesn't support.
 *   - `dynamic = 'force-dynamic'`: opts out of caching — every connect must
 *     resolve the current session and inbox afresh.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEEPALIVE_MS = 25_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Stream already closed.
        }
      };

      // Initial snapshot so the bell renders right away on first connect /
      // reconnect — no polling fallback needed.
      send(sse('snapshot', {
        items: listNotifications(userId),
        unread: unreadCount(userId),
      }));

      unsubscribe = subscribe(userId, (entry: Notification) => {
        send(sse('notification', entry));
      });

      keepaliveTimer = setInterval(() => {
        send(':keepalive\n\n');
      }, KEEPALIVE_MS);

      const abort = () => {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (unsubscribe) unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener('abort', abort);
    },
    cancel() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
