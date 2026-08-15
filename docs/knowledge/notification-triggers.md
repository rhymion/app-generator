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

For a top-level entity, it is wired into the generated
`service_after_create_stub.ts.jinja2` afterCreate hook (called once inside
the entity's `$transaction()`, using `tx` for the role/user lookup reads
only — `notify()` itself is fire-and-forget and not part of that
transaction) — `leave_request`/`receiving_receipt` below are illustrative
example entity names for a consuming schema (this repo's own default
`json_schema.yaml` declares no entity with a `one-to-one_bridge` to
`approvable`, so neither actually exists in this repo's own generated
`lib/`; see `docs/knowledge/appendix/approval-flow.md` §16.2). Wiring a
new entity's approval flow up to this trigger is a matter of calling
`notifyApprovalRequestCreated(tx, approvalRequestId, options)` from that
entity's own `service_after_create.ts` (e.g.
`lib/leave_request/service_after_create.ts`) once its `approval_request`
row is created — the same call also appears in the split-action route
(`code_generator/templates/split_action_route.ts.jinja2`) for
`x-approval-lines` children (§16.10).

**cmd_539**: this trigger also fires on **resubmission** — re-submitting a
rejected `approval_request` reuses the existing row (only its `status`
flips back to `pending`) rather than creating a new one, so this trigger
did not originally re-fire for that transition; approver-role holders were
never told a rejected request needed their attention again after a
resubmit. Both `resubmitApprovalRequest()` implementations (the server
action in `lib/approval_request/actions_core.ts` and the REST route
`app/api/approval_request/[id]/resubmit/route.ts`) now call
`notifyApprovalRequestCreated()` again after the status flip, excluding
the resubmitter. See `docs/knowledge/appendix/approval-flow.md` §16.6 for
the full before/after.

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

### Two independent approve/reject implementations (cmd_479)

`lib/approval_request/actions.ts`'s `approveApprovalRequest()` /
`rejectApprovalRequest()` (server actions, called from the UI's
`ApprovalSection.tsx`) and `app/api/approval_request/[id]/approve|reject/route.ts`
(the REST API, called by external API consumers and by e2e tests) are
**two separate implementations of the same approve/reject transaction**
— not one calling the other. Trigger #3 (`approval_responded`, notifying
the requester of the outcome) must be duplicated in both places; while
investigating the link-target fix, the REST routes were found to have
*no* Trigger #3 notify call at all (not a link bug — a fully missing
notification, pre-existing before cmd_479). Fixed by copying the same
post-transaction `getApprovalRequestRecipient()` + `notify()` block from
`actions.ts` into both route handlers. If either implementation changes
its post-approval/rejection side effects, check whether the other needs
the same change — there's no shared code path enforcing parity.

## Approval order-reached notification (cmd_541)

A `preceded_by` chain (§16.5 of `docs/knowledge/appendix/approval-flow.md`) creates every flow's
`approval_request` up front, when the approvable entity is created — so the "approval request
creation notification" above already fires once for every flow's approver role at that point,
including flows that aren't actionable yet because a preceding flow hasn't been approved. That
earlier notification told them a request exists; it did not tell them when they could actually
act on it. Approving a preceding flow used to be silent for the next flow's approvers — nothing
told them their turn had arrived.

`findNewlyActionableFollowFlowIds()` (`lib/approval_request/order-check.ts`) is called from inside
`approveApprovalRequest()`'s transaction, after the status update, in **both** independent
implementations (`lib/approval_request/actions_core.ts`'s server action and
`app/api/approval_request/[id]/approve/route.ts`'s REST route — see the "Two independent
approve/reject implementations" note above; this trigger needed the same duplication). It walks
the just-approved flow's `followed_by` set and, for each follow-on flow, checks whether *all* of
its `preceded_by` flows now have an approved `approval_request` on the same approvable — the same
check `assertApprovalOrder()` runs in the opposite direction (backward from the flow being acted
on, instead of forward from the flow that just completed).

Any follow-on flow whose ordering constraint just became satisfied gets its approver role notified
via `notifyApprovalOrderReached()` (`lib/_notifyApprovalRequest.ts`, type
`approval_order_reached`) — fired after the transaction commits, using the plain `prisma` client
(not `tx`), the same pattern Trigger #3 above uses. This is a distinct notification type from the
creation-time `approval_requested` one those same approvers already hold, not a duplicate of it —
the two are asserted separately (by type) in
`cypress/e2e/api/multi_stage_approval_order_reached.cy.ts`. A `before.status !== 'approved'` check,
read inside the same transaction as the status update, guards against re-sending this notification
if the same request is ever approved more than once.

## Delivery mechanism

Both triggers share the same notification plumbing:

- `lib/_notifier.ts` — each `notify()` call fire-and-forget writes a row
  to the `notification` Prisma model, the single source of truth read by
  `app/api/notifications/*`. A DB write failure (e.g. an FK violation
  because `user_id` no longer exists) is logged and swallowed, never
  surfaced to the caller. (An in-process `Map<userId, Notification[]>`
  used to back a second, in-memory read path here — `listNotifications()`
  / `unreadCount()` / `markAllRead()` / `clearInbox()` — but it was
  removed (cmd_700): nothing outside this module's own tests ever called
  those four functions.)
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
