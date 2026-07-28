# Notification Triggers

The app has an in-app notification system: a per-user inbox
(`lib/_notifier.ts`), delivered to the client over `/api/notifications/*`
(list and mark-read), and displayed by the `NotificationBell` header
component, which polls for updates. Two triggers currently generate
notifications during entity workflows.

## Self-assignment notification

For any entity whose schema declares an `assignee_id` field, the
generated `service.ts` create/update logic notifies the new assignee:

- **Create**: fires when `assigneeId` is set on creation, unless the
  actor is assigning the item to themself.
- **Update**: fires only when `assigneeId` changes to a different value
  than before, unless the actor is assigning the item to themself.

This behavior is generic and template-driven
(`code_generator/templates/service.ts.jinja2`) — it applies to any
entity with `has_assignee_id`, and the `notify` import is added
conditionally for those entities only.

Currently, the `procedure` and `leave_request` entities declare
`assignee_id` in the schema, so this trigger fires for both. Adding
`assignee_id` (with the matching `x-relationship`) to another entity's
schema definition enables the same behavior for that entity.

## Approval request creation notification

`notifyApprovalRequestCreated()` (`lib/_notifyApprovalRequest.ts`) is
built to notify every user holding the approving role for a newly
created `approval_request`, excluding the requester and optionally
scoped to an organization.

It is called from `lib/leave_request/service_after_create.ts:53` and
`lib/receiving_receipt/service.ts:91,196` (both inside the entity's
`$transaction()`, using `tx` for the role/user lookup reads only —
`notify()` itself is fire-and-forget and not part of that transaction).
Wiring a new entity's approval flow up to this trigger is a matter of
calling `notifyApprovalRequestCreated(tx, approvalRequestId, options)`
from that entity's own `service_after_create.ts` once its
`approval_request` row is created.

## Delivery mechanism

Both triggers share the same notification plumbing:

- `lib/_notifier.ts` — each `notify()` call fire-and-forget writes a row
  to the `notification` Prisma model, the single source of truth read by
  `app/api/notifications/*`. It also updates an in-process
  `Map<userId, Notification[]>` (capped at 50 entries per user, 7-day
  TTL swept on read), kept only for `listNotifications()` /
  `unreadCount()` / `markAllRead()` backward compatibility — nothing in
  `app/api/notifications/*` reads it. A DB write failure (e.g. an FK
  violation because `user_id` no longer exists) is logged and swallowed,
  never surfaced to the caller.
- `app/api/notifications/*` — REST endpoints backed by the
  `notification` table directly: `GET` (7-day filter, 50-row cap, newest
  first, plus unread count) and `POST mark-read` (bulk `updateMany`).
- `components/_standard/NotificationBell.tsx` — header UI that polls
  `GET /api/notifications` on an interval
  (`NEXT_PUBLIC_NOTIFICATION_POLL_INTERVAL_MS`, minutes-scale in
  production / seconds-scale for the e2e suite — see `.env` / `.env.test`)
  and refetches immediately on mount, on bell open, and on window
  focus/`visibilitychange`. There is no push/SSE path: an earlier version
  used an EventEmitter-backed SSE stream for instant same-process
  delivery, but that mechanism is invisible across server
  instances/processes (e.g. serverless) — a `notify()` call in one
  instance never reaches a push subscriber in another — so it was
  retired rather than kept as a delivery path that looks live but isn't
  reliable. Polling against the DB is correct regardless of which
  instance handled the write.
