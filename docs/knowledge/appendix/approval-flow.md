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

### 16.4 Custom hook: `service_after_create.ts`

The generator only creates the `approvable` bridge record. The approval requests themselves are
created in the `afterCreate` custom hook, emitted as a write-once stub
(`code_generator/generate.py:603-606`, template
`code_generator/templates/service_after_create_stub.ts.jinja2`) — generated once, never
overwritten by a later `generate-code` run, so it's safe to hand-edit:

```typescript
// lib/leave_request/service_after_create.ts (code_generator/templates/service_after_create_stub.ts.jinja2:7-64)
export async function afterCreate(tx, created, _data) {
  const approvable = created.approvable as { id: string } | null | undefined;
  if (!approvable?.id) return;

  const creatorId = created.creator_id as string | null | undefined;
  const db = tx as Tx;

  // Find which roles the creator has
  let creatorRoleIds: string[] = [];
  if (creatorId) {
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      select: { roles: { select: { id: true } } },
    });
    creatorRoleIds = creator?.roles.map((r) => r.id) ?? [];
  }

  const flows = await db.approval_flow.findMany({
    where: { entity_name: 'leave_request' },
  });

  for (const flow of flows) {
    // Skip if creator doesn't have the required requestor role
    if (flow.requestor_role_id && !creatorRoleIds.includes(flow.requestor_role_id)) continue;

    await db.approval_request.create({
      data: { approvable_id: approvable.id, approval_flow_id: flow.id, status: 'pending' },
    });
  }
  // ...also notifies every approver-role holder per created approval_request
  // (notifyApprovalRequestCreated) — see the real template for the full body.
}
```

`status` is a string enum value (`'pending'`), not the integer `0` — see §16.7. See
`code-generation-custom-extensions.md` for the full `service_after_create.ts` extension point.

### 16.5 `approval_flow` configuration

`approval_flow` records are created through the admin UI (it has full CRUD pages).

| Field | Type | Purpose |
|---|---|---|
| `entity_name` | `string` | Matches the entity that triggers approval (e.g. `"leave_request"`) |
| `requestor_role_id` | `string \| null` | If set, only users with this role create approval requests |
| `approver_role_id` | `string` | Role required to approve or reject |
| `preceded_by` | M2M self-ref | Other flows that must be Approved before this one becomes actionable |

`entity_name` uses `x-entity-select: true` — a custom field that renders a dropdown listing
all entity names from the schema.

### 16.6 Approval actions

Approval actions live in `lib/approval_request/actions.ts` (a manually maintained file, not
generated). Three server actions are provided:

| Action | Permission check | Result |
|---|---|---|
| `approveApprovalRequest(id, message?)` | User must have `approver_role_id`; all `preceded_by` flows for this approvable must already be `approved` (`assertApprovalOrder()`, §16.6.1) | Sets status → `approved`; notifies the entity creator (Trigger #3, §16.9 note below) |
| `rejectApprovalRequest(id, message?, options?)` | User must have `approver_role_id`; same `assertApprovalOrder()` ordering check as approve | Sets status → `rejected`, or `terminal_rejected` if `isTerminalReject()` says so (§16.11); either way, notifies the entity creator (Trigger #3) with a payload `status` matching the actual outcome |
| `resubmitApprovalRequest(id, message?)` | Creator or user with `requestor_role_id`; only from `rejected` (not `terminal_rejected`) — ordering does not apply, resubmit is requester-initiated | Sets status → `pending`; re-notifies the approver-role holders (cmd_539, see below) |

Each action creates an `approval_history` row recording `pre_status`, `post_status`, `message`,
and `creator_id` (the acting user).

**cmd_539**: `resubmitApprovalRequest()` reuses the existing `approval_request` row (only its
`status` flips back to `pending`) rather than creating a new one, so the create-path notification
(`notifyApprovalRequestCreated()`, Trigger #2, §16.4/next section) never re-fired on resubmission
until this fix — approver-role holders were never told a rejected request needed their attention
again. Both implementations (`lib/approval_request/actions_core.ts`'s `resubmitApprovalRequest()`
and the REST route `app/api/approval_request/[id]/resubmit/route.ts`, see the "two independent
approve/reject implementations" note in `docs/knowledge/notification-triggers.md`) now call
`notifyApprovalRequestCreated()` again after the status flip, excluding the resubmitter. Separately,
the Trigger #3 rejection notification's payload `status` field was hard-coded to `'rejected'` even
for a `terminal_rejected` outcome — the notification always fired either way, but the payload
misreported the outcome; both REST and server-action paths now report the actual status.

**cmd_541 — re-notification when a preceded_by chain advances**: in a multi-stage chain, every
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
is identical regardless of which path a caller uses (cmd_540). Before cmd_540, only the REST
route enforced this; the server action was reachable directly (any authenticated client can
invoke a `'use server'` export via Next.js's Server Action RPC) and had no ordering check at
all — `ApprovalSection.tsx`'s `precedingApproved` computation only controls whether the
Approve/Reject buttons render, it is not an authorization boundary. See
`test/flows/approval_order_bypass.test.ts` for the real-database regression test (calls the
server action directly, bypassing the UI) and `lib/approval_request/actions.test.ts`'s
"assertApprovalOrder gate (cmd_540)" describe block for the mocked-collaborator unit coverage.

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

User creates leave_request:
  service.addLeaveRequest()
    → tx.approvable.create({})            ← pre-created by generator
    → tx.leave_request.create({ approvable_id: approvable.id, ... })
    → afterCreate(tx, created, data)      ← custom hook
        → queries approval_flows for entity_name = 'leave_request'
        → filters by requestor_role_id (if set)
        → creates approval_request { approvable_id, approval_flow_id, status: 'pending' }

View/edit page renders ApprovalSection with:
  - approval_requests with status + approval_flow + approval_histories
  - Approve/Reject buttons (shown if user has approver_role_id AND status='pending' AND preceded_by all 'approved')
  - Resubmit button (shown if status='rejected' AND user is creator or has requestor_role_id —
    NOT offered for status='terminal_rejected', see §16.11)

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

Added in cmd_295. The normal one-to-one `approvable_id` pattern (§16.2) assumes the entity is
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

Added in cmd_305. `rejectApprovalRequest()` (server action, `lib/approval_request/actions.ts`) and
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
plus `isTerminalReject(entityType)` — a lookup against every entity marked `terminal: true`. Terminal rejection means the UI's Resubmit
button (§16.8) is not offered for that entity type; a rejection is final rather than
returning to Pending. For terminal entities, dispatch reuses the same `approvable.approved_at`
column as the fire-once guard (§16.9) — despite the name, it just means "final event already
dispatched for this approvable," approve or reject.

`emit_hook: true` generates a `service_after_reject.ts` once-stub (same non-overwriting
convention as `service_after_approve.ts`, §16.9), with signature
`afterReject(tx, entityId, approvableId, rejectedByUserId)`.
