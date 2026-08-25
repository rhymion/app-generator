# Approval Flow System

> **Source**: Extracted from `docs/knowledge/schema-yaml-configuration.md §16`.
> For the main schema configuration reference, see the parent document.

The approval system is a set of standard entities built into the base schema. Any entity can be
made approvable by adding a `one-to-one_bridge` relationship to `approvable` and mounting the
`ApprovalSection` custom component.

### 16.1 System entities

These definitions must be present in every application schema (they are included in the standard
base `code_generator/json_schema.yaml`):

| Entity | Purpose |
|---|---|
| `approvable` | Bridge record; one-to-one parent for any entity that requires approval |
| `approval_flow` | Configuration: which entity needs approval, which role approves, sequencing |
| `approval_request` | One per (`approvable`, `approval_flow`) pair; tracks `pending`/`approved`/`rejected`/`terminal_rejected` state (§16.7) |
| `approval_history` | Audit trail of every status transition on an `approval_request` |

`approvable_detail` has all `x-generate` flags set to `false` — it is never shown as a standalone
page; it exists only to provide nested type structure for the generator.

### 16.2 Making an entity approvable

**Step 1 — base entity**: add a one-to-one FK to `approvable`:

```yaml
leave_request:
  required:
    - approvable_id
  properties:
    approvable_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
      x-relationship:
        type: one-to-one_bridge
        target: approvable
        labelField: id
```

The relationship type is `one-to-one_bridge`, not the plain `one-to-one` used for a
regular selector FK — `one-to-one_bridge` marks the FK as server-managed plumbing
(auto-created alongside the parent, never user-selected), which is what excludes it
from `get_parent_relationships()` while `get_one_to_one_rels()` still picks it up
(`code_generator/helpers/schema_helpers.py:271-294`, `:346-358`).

**Step 2 — detail entity**: include the resolved `approvable` object and mount `ApprovalSection`:

```yaml
leave_request_detail:
  x-generate:
    view: true
    edit: true
    # ... other flags
  x-custom-components:
    - name: ApprovalSection
      path: "@/components/_standard/ApprovalSection"
      target:
        - view
        - edit
  allOf:
    - $ref: "#/definitions/leave_request"
    - type: object
      properties:
        approvable:
          $ref: "#/definitions/approvable"    # approvable_detail's type provides nested approval_requests
```

### 16.3 What gets generated

The generator detects the `one-to-one_bridge` relationship and extends the normal create path:

1. **`service.ts`** — pre-creates an `approvable` record inside the transaction and stores its
   `id` in `approvable_id`.
2. **`getters.ts`** — the detail query includes `approvable` with a deep nested include:
   ```typescript
   include: {
     approvable: {
       include: {
         approval_requests: {
           include: {
             approval_flow: { include: { requestor_role: true, approver_role: true,
                              preceded_by: { select: { id: true } } } },
             approval_histories: { include: { creator: { select: { id: true, name: true } } } }
           }
         }
       }
     }
   }
   ```
3. **`types.ts`** — the entity type gains a nested `approvable` structure containing `approval_requests[]`
   (with `approval_flow`, `approval_histories`).
4. **`FormView.tsx`** / **`FormUpsert.tsx`** — `ApprovalSection` is rendered at the bottom with
   `src`, `permissions`, `currentUserRoleIds`, and `currentUserId` as props.

### 16.4 Edge-trigger: `x-approval.submit_on`

`service_after_create.ts`'s write-once `afterCreate` hook is retired. Approval-request creation
is now emitted directly into `service.ts.jinja2`'s `add{Parent}`/`update{Parent}` (built by
`generators.py`'s `_build_approval_edge_trigger_create_code`/`_build_approval_edge_trigger_update_code`,
`code_generator/generators.py`), for any entity with an `approvable` one-to-one_bridge — no
custom-hook file to hand-edit.

The trigger fires on the **edge** into `x-approval.submit_on`'s target value, not on a level
check — this is the single point most likely to be gotten wrong (a row that is already at the
target value and gets an unrelated field edited must **not** re-fire, or a second open flow would
violate the "at most one pending flow" invariant, below):

- **Create**: the row's initial state counts as an edge from "no row" (null) into whatever
  `submit_on` requires, so an entity created *already at* the target value fires immediately.
  No `submit_on` declared: fires unconditionally at create time (the historical default).
- **Update**: fires only on `previous != target && new === target` — an explicit
  previous/new comparison, never a bare `if (new === target)`.

Both paths share the same guard against a second open flow:

```typescript
// lib/leave_request/service.ts (generated — add{Parent}, x-approval.submit_on: {status: submitted})
if (created.status === 'submitted') {
  const _pendingGuard = await tx.approval_request.findFirst({
    where: { approvable_id: approvable.id, status: 'pending' },
  });
  if (!_pendingGuard) {
    const _creator = await tx.user.findUnique({ where: { id: actorId }, select: { roles: { select: { id: true } } } });
    const _creatorRoleIds = _creator?.roles.map((r) => r.id) ?? [];
    const _approvalFlows = await tx.approval_flow.findMany({ where: { entity_name: 'leave_request' } });
    // ...creates approval_request per matching flow + notifyApprovalRequestCreated, then
    // stamps approvable.creator_id — same shared block §16.9/§16.10 use
    // (generators._build_approval_create_block_for_entity).
  }
}
```

```yaml
leave_request:
  x-approval:
    submit_on:
      status: submitted   # {field: value} — same shape as on_approved/on_rejected.set_fields
```

`submit_on` is a `{field: value}` mapping (exactly one entry — resolved through the same
`resolve_set_fields()` legacy-int-enum-label path `on_approved`/`on_rejected.set_fields` use), not
a bare scalar — kept consistent with the rest of `x-approval`'s field-scoped declarations rather
than assuming a fixed field name.

**Re-submission** is no longer a dedicated action: it is an ordinary edit of the entity's own
status field back to `submit_on`'s value (through the normal edit form/API), which fires the
*update*-time trigger exactly like a first submission fires the *create*-time trigger. See §16.6.

### 16.5 `approval_flow` configuration

`approval_flow` records are created through the admin UI (it has full CRUD pages).

| Field | Type | Purpose |
|---|---|---|
| `entity_name` | `string` | Matches the entity that triggers approval (e.g. `"leave_request"`) |
| `requestor_role_id` | `string \| null` | If set, only users with this role create approval requests |
| `approver_role_id` | `string` | Role required to approve or reject |
| `preceded_by` | M2M self-ref | Other flows that must be Approved before this one becomes actionable |

`entity_name` uses `x-entity-select: true` — a custom field that renders a dropdown listing
all generated entity view keys from the schema.

**`entity_name` is the entity's view key (`parent`), not its Prisma model.** A proxy view can
carry its own independent set of approval flows even when it shares a model with other views —
`resolveApprovableTarget`/`resolveApprovableModel` (`lib/approval_request/resolve_target.ts`,
generated) resolve a view key to the row/model it actually needs; `on_approved_dispatch.ts`/
`on_rejected_dispatch.ts` stay keyed by model (`x-approval` is a raw-entity-level declaration,
shared by every view over that model), so `actions_core.ts` translates the view key to a model
name via `resolveApprovableModel()` before dispatching to either.

### 16.6 Approval actions

Approval actions live in `lib/approval_request/actions.ts` (a manually maintained file, not
generated). Two server actions are provided:

| Action | Permission check | Result |
|---|---|---|
| `approveApprovalRequest(id, message?)` | User must have `approver_role_id`; all `preceded_by` flows for this approvable must already be `approved` (`assertApprovalOrder()`, §16.6.1) | Sets status → `approved`; notifies the entity creator (Trigger #3, §16.9 note below) |
| `rejectApprovalRequest(id, message?, options?)` | User must have `approver_role_id`; same `assertApprovalOrder()` ordering check as approve | Sets status → `rejected`, or `terminal_rejected` if `isTerminalReject()` says so (§16.11); either way, notifies the entity creator (Trigger #3) with a payload `status` matching the actual outcome |

Each action creates an `approval_history` row recording `pre_status`, `post_status`, `message`,
and `creator_id` (the acting user).

**There is no dedicated resubmit action or route.** Re-submission after a non-terminal rejection
is an ordinary edit of the entity's own status field back to `x-approval.submit_on`'s value
(§16.4) — the same update-time edge trigger a first submission fires at create time creates a
fresh `approval_request` and notifies the approver-role holders, with no separate code path to
keep in sync. Separately (still true): the Trigger #3 rejection notification's payload `status`
field must match the actual outcome (`'rejected'` vs. `'terminal_rejected'`), not a hard-coded
literal.

**Re-notification when a preceded_by chain advances**: in a multi-stage chain, every
flow's `approval_request` is created up front when the approvable entity is created (§16.4/16.8),
and every flow's approver role is notified then — even flows that aren't actionable yet because a
preceding flow hasn't been approved (§16.5's `preceded_by`). Approving a flow used to be silent
for the *next* flow's approvers: nothing told them their turn had arrived, short of checking the
item themselves. `approveApprovalRequest()` (both this file's server action and the REST route's
independent implementation, per the "two independent implementations" note in
`docs/knowledge/notification-triggers.md`) now calls
`lib/approval_request/order-check.ts`'s `findNewlyActionableFollowFlowIds()` after updating status
— it walks the just-approved flow's `followed_by` set and checks, for each follow-on flow, whether
*all* of its `preceded_by` flows now have an approved `approval_request` on the same approvable.
Any flow that just crossed that threshold gets its approver role notified via
`lib/_notifyApprovalRequest.ts`'s `notifyApprovalOrderReached()` (type `approval_order_reached`) —
a distinct notification from the creation-time `approval_requested` one those same approvers
already hold, not a duplicate of it. A `before.status !== 'approved'` guard, checked inside the
same transaction as the status update, prevents re-notifying if the same request is ever approved
more than once. See `docs/knowledge/notification-triggers.md` for the full trigger list.

#### 16.6.1 Ordering enforcement (`assertApprovalOrder`)

`lib/approval_request/order-check.ts` (manually maintained, not generated) exports
`assertApprovalOrder(id)`: given an `approval_request` id, it loads the request's
`approval_flow.preceded_by` flow ids and confirms every sibling `approval_request` on the
same `approvable` for those flows already has `status: 'approved'`; otherwise it throws
(`'Preceding approval requests must be approved first'`).

Both entry points that can transition an `approval_request` call this same function — the
REST route (`app/api/approval_request/[id]/{approve,reject}/route.ts`) and the server action
(`lib/approval_request/actions_core.ts`'s `approveApprovalRequest`/`rejectApprovalRequest`,
called via `approve`/`reject` in `lib/approval_request/actions.ts`) — so the rejection wording
is identical regardless of which path a caller uses (added by an earlier fix). Before that fix, only the REST
route enforced this; the server action was reachable directly (any authenticated client can
invoke a `'use server'` export via Next.js's Server Action RPC) and had no ordering check at
all — `ApprovalSection.tsx`'s `precedingApproved` computation only controls whether the
Approve/Reject buttons render, it is not an authorization boundary. See
`test/flows/approval_order_bypass.test.ts` for the real-database regression test (calls the
server action directly, bypassing the UI) and `lib/approval_request/actions.test.ts`'s
ordering-gate describe block for the mocked-collaborator unit coverage.

### 16.7 Prisma models required

Verified against the generated `prisma/schema.prisma:168-236` (models trimmed to the fields
this document discusses; indexes omitted):

```prisma
model approvable {
  id                String             @id @default(cuid())
  creator_id        String?
  creator           user?              @relation("ApprovableCreator", ...)
  approval_requests approval_request[]
  approved_at       DateTime?          // fire-once guard, §16.9/§16.11
  rejection_reason  String?            // set by rejectApprovalRequest()'s optional `reason`
  leave_request     leave_request?
}

model approval_flow {
  id                String             @id @default(cuid())
  entity_name       String
  requestor_role_id String?
  requestor_role    role?              @relation("ApprovalFlowRequestorRole", ...)
  approver_role_id  String
  approver_role     role               @relation("ApprovalFlowApproverRole", ...)
  approval_requests approval_request[]
  preceded_by       approval_flow[]    @relation("ApprovalFlowOrder")
  followed_by       approval_flow[]    @relation("ApprovalFlowOrder")
  created_at        DateTime           @default(now())
  updated_at        DateTime           @updatedAt
  creator_id        String
  creator           user       @relation("ApprovalFlowCreator", ...)
  updater_id        String
  updater           user       @relation("ApprovalFlowUpdater", ...)
}

// prisma/schema.prisma:201-206
enum ApprovalRequestStatus {
  pending
  approved
  rejected
  terminal_rejected
}

model approval_request {
  id                  String                @id @default(cuid())
  approvable_id       String
  approvable          approvable            @relation(fields: [approvable_id], references: [id], onDelete: Cascade)
  approval_flow_id    String
  approval_flow       approval_flow         @relation(fields: [approval_flow_id], references: [id])
  status              ApprovalRequestStatus @default(pending)
  approval_histories  approval_history[]
}

model approval_history {
  id                  String           @id @default(cuid())
  approval_request_id String
  approval_request    approval_request @relation(fields: [approval_request_id], references: [id], onDelete: Cascade)
  pre_status          Int              // legacy ordinal snapshot, NOT the ApprovalRequestStatus enum — see below
  post_status         Int              // ditto
  message             String?
  reason_kind         Int?             // 0=Customer 1=Internal — see §16.11
  created_at          DateTime         @default(now())
  creator_id          String
  creator             user     @relation("ApprovalHistoryCreator", ...)
}
```

**`status` is a string enum, not an integer.** `approval_request.status` is
`ApprovalRequestStatus` (`pending` / `approved` / `rejected` / `terminal_rejected`), matching
`code_generator/json_schema.yaml:338-343`'s `enum:` list for the field. Application code reads
and writes the lower-case string values directly (e.g. `data: { status: 'approved' }` in
`lib/approval_request/actions_core.ts:144`, `app/api/approval_request/[id]/approve/route.ts:35`).

`approval_history.pre_status`/`post_status` are a **separate, still-integer** pair of columns —
a legacy ordinal snapshot, out of scope for the string-enum migration. `statusOrdinal()` in
`lib/approval_request/actions_core.ts:9-12` maps the enum back to its historical ordinal index
(`['pending', 'approved', 'rejected', 'terminal_rejected']`) when a history row needs to record
one; some call sites (e.g. the approve API route) just hard-code the known literal instead
(`app/api/approval_request/[id]/approve/route.ts:44`, `pre_status: 0, post_status: 1`).

### 16.8 Data flow summary

```
Admin creates approval_flow { entity_name: 'leave_request', approver_role_id: <roleId> }

User creates leave_request (status at or entering x-approval.submit_on's value, e.g. 'submitted'):
  service.addLeaveRequest()
    → tx.approvable.create({})            ← pre-created by generator
    → tx.leave_request.create({ approvable_id: approvable.id, ... })
    → edge-trigger block (generated inline, §16.4) — fires because created.status matches submit_on
        → _pendingGuard: no open flow already exists for this approvable
        → queries approval_flows for entity_name = 'leave_request' (the view key)
        → filters by requestor_role_id (if set)
        → creates approval_request { approvable_id, approval_flow_id, status: 'pending' }

View/edit page renders ApprovalSection with:
  - approval_requests with status + approval_flow + approval_histories
  - Approve/Reject buttons (shown if user has approver_role_id AND status='pending' AND preceded_by all 'approved')
  - No resubmit button — re-submission after a non-terminal rejection is an ordinary edit of the
    entity's own status field back to submit_on's value, which fires the same edge-trigger block
    above via updateLeaveRequest() instead of addLeaveRequest() (see §16.4/§16.6)

Approver clicks Approve:
  approveApprovalRequest(id)
    → checks user has approver_role_id
    → assertApprovalOrder(id): all preceded_by flows' approval_requests must be 'approved' (§16.6.1)
    → updates approval_request.status = 'approved'
    → creates approval_history { pre_status: 0, post_status: 1, ... }  (legacy Int columns, §16.7)
    → if ALL of this approvable's approval_requests are now 'approved' AND approved_at is
      still null: sets approved_at, dispatches on_approved events (see §16.9)
    → revalidates path
```

### 16.9 Post-approval event dispatch (`x-approval.on_approved`)

Added in v1.5.0. When at least one entity schema includes `x-approval.on_approved`, the
generator emits a single shared dispatch module,
**`lib/approval_request/on_approved_dispatch.ts`** (overwritten on every `generate-code` run,
built from every qualifying entity — not one file per entity), and wires it into both the API
route (`approve/route.ts`) and server action approval paths
(`code_generator/generate.py:1063-1135`, template `on_approved_dispatch.ts.jinja2`).

Fire-once idempotency is guaranteed by `approvable.approved_at`: the dispatch runs only once
**all** of the approvable's `approval_request` rows have reached `status: 'approved'` (an
approvable can carry more than one, e.g. a multi-step chain ordered by `preceded_by`/
`followed_by`) **and** `approved_at` is still `null`, then sets `approved_at` to the current
timestamp in the same transaction before dispatching
(`lib/approval_request/actions_core.ts:160-178`,
`app/api/approval_request/[id]/approve/route.ts:46-60`).

#### Schema: `on_approved.set_fields`

Performs arbitrary field updates on the entity at approval time.

```yaml
purchase_order:
  x-approval:
    on_approved:
      set_fields:
        status: "approved"   # string label (resolved to integer index for Int fields)
```

`set_fields` is a **mapping** of `field_name: value` — matching §16.11's `on_rejected.set_fields`
below, and the only form `_resolve_set_fields()` (`code_generator/generate.py:289`) accepts (it
iterates `raw.items()`). A list-of-`{field, value}` form is rejected before generation runs by
`validate_schema()`'s `x-approval.set_fields` check (`code_generator/validate.py`), with an error
naming the entity, the offending key, and the correct mapping form.

The generator resolves enum labels to integer indices when the target field type is `integer`,
preventing TypeScript build errors in the generated dispatch file.

#### Schema: `on_approved.emit_hook`

Generates `lib/{entity}/service_after_approve.ts` as a **once-stub** (written only when the file
does not exist; never overwritten by `generate-code` re-runs — template
`service_after_approve_stub.ts.jinja2`). This is the safe extension point for custom
post-approval logic.

```yaml
purchase_order:
  x-approval:
    on_approved:
      emit_hook: true
```

Generated stub (`lib/purchase_order/service_after_approve.ts`, trimmed to the non-ledger case —
`code_generator/templates/service_after_approve_stub.ts.jinja2:9-34`):

```typescript
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function afterApprove(
  tx: Tx,
  entityId: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  // TODO: implement post-approval effects here
}
```

#### Generated `on_approved_dispatch.ts`

This is **one shared file** covering every entity that declares `x-approval.on_approved` — not
one file per entity (see the correction above). Each qualifying entity gets its own
`if (entityType === '...')` branch inside a single `dispatchOnApproved()` function
(`code_generator/templates/on_approved_dispatch.ts.jinja2`):

```typescript
// lib/approval_request/on_approved_dispatch.ts  (generated — do not edit)
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

import { afterApprove as PurchaseOrderAfterApprove } from '@/lib/purchase_order/service_after_approve';

export async function dispatchOnApproved(
  tx: Tx,
  entityType: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  if (entityType === 'purchase_order') {
    const entity = await tx.purchase_order.findFirst({ where: { approvable_id: approvableId } });
    if (!entity) return;

    // set_fields (auto-generated from x-approval.on_approved.set_fields)
    await tx.purchase_order.update({ where: { id: entity.id }, data: { status: 1 } });

    // emit_hook
    await PurchaseOrderAfterApprove(tx, entity.id, approvableId, approvedByUserId);
    return;
  }
  // ...one branch per qualifying entity
}
```

Note the caller (`approveApprovalRequest()` / the approve API route, §16.8) — not this
function — owns the `approvable.approved_at` fire-once check and the transaction; by the time
`dispatchOnApproved` runs, `approved_at` has already been set.

### 16.10 Approval for embedded line children (`x-approval-lines`)

Added in an earlier task. The normal one-to-one `approvable_id` pattern (§16.2) assumes the entity is
top-level and its own `create` call is where the `approvable` gets pre-created. That breaks down
for an embedded, `new: false` line child of a nested-create array (e.g.
`receiving_receipt.lines[]` → `receiving_receipt_line`, `purchase_order.lines[]` →
`purchase_per_item`): there is no standalone `create` entry point for the child to hook into, and
a `NOT NULL approvable_id` on the child can't be satisfied by the generic nested-create path.

Declared on the **parent** (base entity, not `_detail`):

```yaml
receiving_receipt:
  x-approval-lines:
    - lines            # property name of the nested-create array on receiving_receipt_detail
```

The generator (`get_approval_lines_props()` in `helpers/schema_helpers.py`) resolves this to the
line entity's own `x-approval` config and wires two code blocks into the parent's `service.ts`
create (and, for newly-added lines only, update) path:

1. **Pre-create** (`_build_approval_lines_pre_create_code`) — before the parent's nested-create
   call, pre-creates one empty `approvable` row per incoming line (mirrors the single-entity
   pre-create in §16.3, just looped per array element).
2. **Post-create** (`_build_approval_lines_post_create_code`) — after the nested-create commits
   (so each line has an `id`), looks up matching `approval_flow` rows for the line entity's own
   `entity_name`, filters by the actor's roles, and creates one `approval_request` per matching
   flow against each line's pre-created `approvable` — reusing the same creator-role-filtered
   block shared with split part allocation (`_build_approval_create_block_for_entity`).

On `update`, only lines without an existing `id` (i.e. newly appended in this edit) go through
pre-create/post-create — existing lines already have an `approvable` from their original create.

The line entity itself still declares `x-approval.on_approved` / `on_rejected` exactly as in
§16.9 / §16.11 — `x-approval-lines` only solves *how the approvable gets created* for an embedded
child; approval and rejection dispatch behave identically to a top-level approvable entity once
that pre-create has happened.

### 16.11 Rejection classification and dispatch (`reason_kind`, `x-approval.on_rejected`)

Added in an earlier task. `rejectApprovalRequest()` (server action, `lib/approval_request/actions.ts`) and
`POST /api/approval_request/{id}/reject` (REST route) both accept an optional `reason_kind`
(`0 = Customer`, `1 = Internal`) alongside the free-text rejection message, stored on the
`approval_history` row:

```prisma
model approval_history {
  reason_kind Int?   // 0=Customer 1=Internal — classification of a rejection's cause
}
```

`ApprovalSection.tsx` offers this as a dropdown next to the rejection message field whenever the
action is `reject`; both the server-action and REST paths write the same field so the
classification is consistent regardless of which path the client uses.

**Post-rejection event dispatch** mirrors §16.9's `dispatchOnApproved`, generated from
`x-approval.on_rejected` on the entity schema:

```yaml
receiving_receipt_line:
  x-approval:
    on_rejected:
      terminal: true       # rejected requests of this entity type cannot be resubmitted
      emit_hook: false
      set_fields:
        status: "rejected"
```

**`lib/approval_request/on_rejected_dispatch.ts`** — one shared, generated module (not one file
per entity; generated, `code_generator/generate.py:1186-1215`, template
`on_rejected_dispatch.ts.jinja2`) — exposes `dispatchOnRejected(tx, entityType, approvableId,
rejectedByUserId)`, called from the reject path after `approval_request.status` is updated,
plus `isTerminalReject(entityType)` — a lookup against every entity marked `terminal: true`. For
terminal entities, dispatch reuses the same `approvable.approved_at` column as the fire-once guard
(§16.9) — despite the name, it just means "final event already dispatched for this approvable,"
approve or reject. `on_rejected.set_fields` is expected to move the entity's status to a value
outside the normal edit flow's reach (e.g. `terminal_rejected`), so re-submission has no
`submit_on`-value target to edit back into under the intended workflow.

**Known gap**: "terminal reject → no resubmission" is not independently machine-enforced at the
edge-trigger level (§16.4) the way "at most one open flow" is. The edge trigger's `_pendingGuard`
only blocks a *second* pending flow — a terminal-rejected approvable has none, so if something
did set the entity's status back to `submit_on`'s value (a direct API write, or an edit form that
doesn't otherwise restrict it), a fresh `approval_request` would be created. Closing this
gap needs either previous-state-aware update validation or a status-field write path restricted to
the approval flow itself — both deferred design questions, not yet decided.

`emit_hook: true` generates a `service_after_reject.ts` once-stub (same non-overwriting
convention as `service_after_approve.ts`, §16.9), with signature
`afterReject(tx, entityId, approvableId, rejectedByUserId)`.
