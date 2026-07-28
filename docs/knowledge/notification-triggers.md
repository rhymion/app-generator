# Notification Triggers

The app has an in-app notification system: an in-process per-user inbox
(`lib/_notifier.ts`), delivered to the client over `/api/notifications/*`
(list, mark-read, and an SSE stream), and displayed by the
`NotificationBell` header component. Two triggers currently generate
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

Currently, only the `procedure` entity declares `assignee_id` in the
schema, so this trigger only fires for `procedure`. Adding
`assignee_id` (with the matching `x-relationship`) to another entity's
schema definition enables the same behavior for that entity.

## Approval request creation notification

`notifyApprovalRequestCreated()` (`lib/_notifyApprovalRequest.ts`) is
built to notify every user holding the approving role for a newly
created `approval_request`, excluding the requester and optionally
scoped to an organization.

This function currently has no call sites anywhere in the codebase. As
a result, no notification is sent when an approval request is created,
for any entity, until something invokes it — e.g. from the relevant
entity's `service_after_create.ts`.

## Delivery mechanism

Both triggers share the same notification plumbing:

- `lib/_notifier.ts` — in-process `Map<userId, Notification[]>`, capped
  at 50 entries per user with a 7-day TTL sweep. Not persisted to the
  database and not shared across multiple server instances.
- `app/api/notifications/*` — REST endpoints to list notifications,
  mark them read, and stream new ones over SSE.
- `components/_standard/NotificationBell.tsx` — header UI that renders
  the inbox.
