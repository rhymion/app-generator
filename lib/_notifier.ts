import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';

/**
 * Per-user notification inbox.
 *
 * Producers (entity services, approval / comment actions) call `notify(userId, …)`
 * after their own transaction commits. The call is fire-and-forget — it does
 * not need to share a transaction with the originating event.
 *
 * Storage is dual-path:
 *   - An in-process `Map<userId, Notification[]>` (capped per user, TTL
 *     swept on read) backs `listNotifications()` / `unreadCount()` /
 *     `markAllRead()` below. Nothing in `app/api/notifications/` reads
 *     these anymore (see below) — they're kept only so existing callers
 *     and this module's own test suite keep working unchanged.
 *   - The `notification` Prisma model (`prisma/schema.prisma`) is the
 *     single source of truth read by the API routes under
 *     `app/api/notifications/` directly (not through this module), so the
 *     bell stays correct across server restarts and across Node
 *     processes/instances (e.g. serverless) where the in-process Map is
 *     invisible to other instances. The DB write below is fire-and-forget
 *     and best-effort: a failure (e.g. an FK violation because the target
 *     user no longer exists) is logged and swallowed, never thrown back at
 *     the caller.
 *
 * No same-process push mechanism (previously an EventEmitter backing an
 * SSE `subscribe()`) exists anymore: it was retired because it cannot be
 * relied on for correctness in a multi-instance/serverless deployment —
 * `notify()` in one instance is invisible to a push subscriber in another
 * — and keeping a mechanism that "looks live but only works sometimes" is
 * worse than not having it. `NotificationBell.tsx` now polls
 * `GET /api/notifications` (DB-backed) instead, which is correct
 * regardless of which instance handled the write.
 *
 * The `notify()` interface is intentionally narrow so either backing store
 * can be swapped (e.g. Redis / a queue) without touching callers.
 *
 * See docs/knowledge/notification-triggers.md for notification system design.
 *
 * Operational note: because the in-memory half of this store has no
 * persistence, any notification written before a server restart (rebuild,
 * redeploy, crash) is unrecoverable from the Map — though it does survive
 * in the `notification` table. The line below logs once per process start
 * specifically so that gap is visible in server logs instead of silently
 * reading as "no notification was ever generated" when the real cause is
 * "the process that generated it is gone".
 */
console.log(
  `[_notifier] in-memory notification store initialized (pid=${process.pid}). ` +
    'Notifications created before this point (previous process) are only recoverable from the notification table.',
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

// Exported so the DB-backed reads in app/api/notifications/* apply the same
// cap/TTL as the in-memory store below (fixed values for now; making these
// configurable is deferred).
export const INBOX_CAP = 50;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inbox = new Map<string, Notification[]>();

function pruneExpired(items: Notification[]): Notification[] {
  const cutoff = Date.now() - TTL_MS;
  return items.filter((n) => n.createdAt >= cutoff);
}

/**
 * Best-effort persistence for `notify()`. Never throws: a write failure
 * (most commonly an FK violation on `user_id` because the target user was
 * deleted between the triggering action and this write) must not take down
 * the caller's request. Per product decision, a notification aimed at a
 * disabled-but-not-deleted user is harmless and expected to succeed; only a
 * truly nonexistent user_id fails, and that failure is swallowed here.
 */
async function writeToDb(entry: Notification): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        id: entry.id,
        user_id: entry.userId,
        type: entry.type,
        payload: entry.payload as Prisma.InputJsonValue,
        read: entry.read,
        created_at: new Date(entry.createdAt),
      },
    });
  } catch (err) {
    console.warn(
      '[_notifier:write_failed]',
      JSON.stringify({
        at: new Date().toISOString(),
        userId: entry.userId,
        type: entry.type,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
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
  void writeToDb(entry);
  return entry;
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
}
