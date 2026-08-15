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
 * The `notification` Prisma model (`prisma/schema.prisma`) is the single
 * source of truth, read by the API routes under `app/api/notifications/`
 * directly (not through this module), so the bell stays correct across
 * server restarts and across Node processes/instances (e.g. serverless).
 * The DB write below is fire-and-forget and best-effort: a failure (e.g. an
 * FK violation because the target user no longer exists) is logged and
 * swallowed, never thrown back at the caller.
 *
 * This module used to also keep an in-process `Map<userId, Notification[]>`
 * as a second, in-memory read path (`listNotifications()` / `unreadCount()`
 * / `markAllRead()` / `clearInbox()`), alongside the DB write above. It was
 * removed (cmd_700): `app/api/notifications/*` has read the `notification`
 * table directly since the table was introduced, and nothing else in this
 * app (production code or generated templates) ever called those four
 * functions — only this module's own test suite did. The Map only grew
 * (one entry per distinct user ever notified, for the life of the process)
 * without ever being queried by a real consumer.
 *
 * No same-process push mechanism (previously an EventEmitter backing an
 * SSE `subscribe()`) exists anymore: it was retired because it cannot be
 * relied on for correctness in a multi-instance/serverless deployment —
 * `notify()` in one instance is invisible to a push subscriber in another
 * — and keeping a mechanism that "looks live but only works sometimes" is
 * worse than not having it. `NotificationBell.tsx` polls
 * `GET /api/notifications` (DB-backed) instead, which is correct
 * regardless of which instance handled the write.
 *
 * See docs/knowledge/notification-triggers.md for notification system design.
 */

export type NotificationType =
  | 'assigned'
  | 'approval_requested'
  | 'approval_responded'
  | 'approval_order_reached'
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
// cap/TTL this module used to enforce in-memory (fixed values for now;
// making these configurable is deferred).
export const INBOX_CAP = 50;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

export function notify(userId: string, type: NotificationType, payload: NotificationPayload): void {
  const entry: Notification = {
    id: randomUUID(),
    userId,
    type,
    payload,
    createdAt: Date.now(),
    read: false,
  };
  void writeToDb(entry);
}
