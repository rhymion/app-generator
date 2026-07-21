import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

/**
 * In-process per-user notification inbox.
 *
 * Producers (entity services, approval / comment actions) call `notify(userId, …)`
 * after their own transaction commits. The call is fire-and-forget — it does
 * not need to share a transaction with the originating event. Storage is a
 * `Map<userId, Notification[]>` capped per user with a TTL sweep, so old
 * entries don't pin memory and unknown users (logged-out, deleted) get
 * dropped on the next eviction.
 *
 * Trade-offs:
 *   - Lost on server restart. Acceptable for the dev/tutorial app.
 *   - Not shared across multiple Node processes — single-instance only.
 *   - The `notify()` interface is intentionally narrow so the backing store
 *     can swap to Redis / a queue without touching callers.
 *
 * See performance-plan-session.md (notification design choice 2026-05-11).
 *
 * Operational note: because this store has no persistence, any notification
 * written before a server restart (rebuild, redeploy, crash) is
 * unrecoverable — there is no database row or queue entry to fall back to.
 * The line below logs once per process start specifically so that gap is
 * visible in server logs instead of silently reading as "no notification
 * was ever generated" when the real cause is "the process that generated it
 * is gone".
 */
console.log(
  `[_notifier] in-memory notification store initialized (pid=${process.pid}). ` +
    'Notifications created before this point (previous process) are not recoverable.',
);

export type NotificationType =
  | 'assigned'
  | 'approval_requested'
  | 'approval_responded'
  | 'comment_created'
  | string;

export interface NotificationPayload {
  title: string;
  href?: string;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  payload: NotificationPayload;
  createdAt: number;
  read: boolean;
}

const INBOX_CAP = 50;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inbox = new Map<string, Notification[]>();
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

function pruneExpired(items: Notification[]): Notification[] {
  const cutoff = Date.now() - TTL_MS;
  return items.filter((n) => n.createdAt >= cutoff);
}

export function notify(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Notification {
  const entry: Notification = {
    id: randomUUID(),
    userId,
    type,
    payload,
    createdAt: Date.now(),
    read: false,
  };
  const existing = pruneExpired(inbox.get(userId) ?? []);
  existing.push(entry);
  if (existing.length > INBOX_CAP) {
    existing.splice(0, existing.length - INBOX_CAP);
  }
  inbox.set(userId, existing);
  emitter.emit('notify', entry);
  return entry;
}

/**
 * Subscribe to notifications for a single user. The handler fires when
 * `notify(userId, …)` is invoked anywhere in the process. Returns an
 * unsubscribe function — call it on connection abort to avoid leaks.
 *
 * Used by /api/notifications/stream to push events to the bell via SSE
 * without the client polling.
 */
export function subscribe(
  userId: string,
  handler: (entry: Notification) => void,
): () => void {
  const wrapped = (entry: Notification) => {
    if (entry.userId === userId) handler(entry);
  };
  emitter.on('notify', wrapped);
  return () => {
    emitter.off('notify', wrapped);
  };
}

export function listNotifications(userId: string): Notification[] {
  const items = pruneExpired(inbox.get(userId) ?? []);
  // Newest first — what a bell dropdown displays.
  return [...items].reverse();
}

export function unreadCount(userId: string): number {
  return (inbox.get(userId) ?? []).filter((n) => !n.read).length;
}

export function markAllRead(userId: string): number {
  const items = inbox.get(userId);
  if (!items) return 0;
  let changed = 0;
  for (const n of items) {
    if (!n.read) {
      n.read = true;
      changed++;
    }
  }
  return changed;
}

export function clearInbox(userId: string): void {
  inbox.delete(userId);
}

export function _resetForTests(): void {
  inbox.clear();
  emitter.removeAllListeners();
}
