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

### Link target convention (cmd_479)

An approval notification must link to the **approvable's own detail
page** (`/{entityName}/view/{id}`) — the item an approver actually needs
to review — never to `/approval_request/view/{id}`. That route does not
exist: `approval_request` has no `x-generate: {view: true}`, since it's
a bridge/workflow row, not a page-worthy entity in its own right.

`approval_request`/`approvable` are polymorphic — the row doesn't know
which entity it belongs to, only the reverse (the target entity holds
`approvable_id`). Two resolution strategies are used, chosen by whether
the target entity/row is already known at the call site:

- **Known at call time** (Trigger #2, from any entity's own generated
  code — the top-level `service_after_create_stub.ts.jinja2`, the
  x-approval-lines post-create block, and the split-action route):
  the caller passes `targetEntityName`/`targetId` straight into
  `notifyApprovalRequestCreated()`'s options — no DB lookup needed, the
  entity name is a template-time literal and the row was just created.
- **Only known at runtime** (Trigger #3, `lib/approval_request/actions.ts`
  approve/reject — a single shared handler for every entity's approval
  requests): `lib/approval_request/resolve_target.ts` (generated,
  mirrors `on_approved_dispatch.ts`'s per-entity branch pattern) maps
  `entity_name + approvable_id -> { id }` via one
  `tx.{entity}.findFirst({ where: { approvable_id } })` branch per
  entity declaring an `approvable` bridge. Always emitted, even with
  zero such entities, since `actions.ts` imports it unconditionally.

If neither can resolve a target, `href` is omitted (not defaulted to a
guessed or broken link) — the bell shows a non-clickable notice instead.

New entities wiring into either trigger don't need any extra schema
config for this — the target link follows automatically from the
entity's own `x-relationship: {type: one-to-one_bridge, target:
approvable}` declaration.

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
