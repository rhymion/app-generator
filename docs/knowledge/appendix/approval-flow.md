# Approval Flow System

> **Source**: Extracted from `docs/knowledge/schema-yaml-configuration.md §16`.
> For the main schema configuration reference, see the parent document.

The approval system is a set of standard entities built into the base schema. Any entity can be
made approvable by adding a one-to-one relationship to `approvable` and mounting the
`ApprovalSection` custom component.

### 16.1 System entities

These definitions must be present in every application schema (they are included in the standard
base `code_generator/json_schema.yaml`):

| Entity | Purpose |
|---|---|
| `approvable` | Bridge record; one-to-one parent for any entity that requires approval |
| `approval_flow` | Configuration: which entity needs approval, which role approves, sequencing |
| `approval_request` | One per (`approvable`, `approval_flow`) pair; tracks Pending/Approved/Rejected state |
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
        type: one-to-one
        target: approvable
        labelField: id
```

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

The generator detects the `one-to-one` relationship and extends the normal create path:

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
created in the `afterCreate` custom hook:

```typescript
// lib/leave_request/service_after_create.ts
export async function afterCreate(tx, created, _data) {
  const approvable = created.approvable as { id: string };
  const creator = created.creator_id as string;

  // Find which roles the creator has
  const creatorRoleIds = await (tx as Tx).user_roles.findMany(...)

  const flows = await (tx as Tx).approval_flow.findMany({
    where: { entity_name: 'leave_request' },
  });

  for (const flow of flows) {
    // Skip if creator doesn't have the required requestor role
    if (flow.requestor_role_id && !creatorRoleIds.includes(flow.requestor_role_id)) continue;

    await (tx as Tx).approval_request.create({
      data: { approvable_id: approvable.id, approval_flow_id: flow.id, status: 0 },
    });
  }
}
```

See `code-generation-custom-extensions.md` for the full `service_after_create.ts` extension point.

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
| `approveApprovalRequest(id, message?)` | User must have `approver_role_id` | Sets status → Approved |
| `rejectApprovalRequest(id, message?)` | User must have `approver_role_id` | Sets status → Rejected |
| `resubmitApprovalRequest(id, message?)` | Creator or user with `requestor_role_id` | Sets status → Pending |

Each action creates an `approval_history` row recording `pre_status`, `post_status`, `message`,
and `creator_id` (the acting user).

### 16.7 Prisma models required

```prisma
model approvable {
  id               String             @id @default(cuid())
  approval_requests approval_request[]
  leave_request    leave_request?
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

model approval_request {
  id                  String             @id @default(cuid())
  approvable_id       String
  approvable          approvable         @relation(fields: [approvable_id], references: [id], onDelete: Cascade)
  approval_flow_id    String
  approval_flow       approval_flow      @relation(fields: [approval_flow_id], references: [id])
  status              Int                @default(0)   // 0=Pending 1=Approved 2=Rejected
  approval_histories  approval_history[]
}

model approval_history {
  id                  String           @id @default(cuid())
  approval_request_id String
  approval_request    approval_request @relation(fields: [approval_request_id], references: [id], onDelete: Cascade)
  pre_status          Int
  post_status         Int
  message             String?
  created_at          DateTime         @default(now())
  creator_id          String
  creator             user     @relation("ApprovalHistoryCreator", ...)
}
```

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
        → creates approval_request { approvable_id, approval_flow_id, status: 0 }

View/edit page renders ApprovalSection with:
  - approval_requests with status + approval_flow + approval_histories
  - Approve/Reject buttons (shown if user has approver_role_id AND status=Pending AND preceded_by all Approved)
  - Resubmit button (shown if status=Rejected AND user is creator or has requestor_role_id)

Approver clicks Approve:
  approveApprovalRequest(id)
    → checks user has approver_role_id
    → updates approval_request.status = 1
    → creates approval_history { pre_status: 0, post_status: 1, ... }
    → dispatches on_approved events (see §16.9)
    → revalidates path
```

### 16.9 Post-approval event dispatch (`x-approval.on_approved`)

Added in v1.5.0. When an entity schema includes `x-approval.on_approved`, the generator creates
`lib/{entity}/on_approved_dispatch.ts` (overwritten on each `generate-code` run) and wires it
into both the API route (`approve/route.ts`) and server action approval paths.

Fire-once idempotency is guaranteed by `approvable.approved_at`: the dispatch runs only when
`approved_at` is `null`, then sets it to the current timestamp in the same transaction.

#### Schema: `on_approved.set_fields`

Performs arbitrary field updates on the entity at approval time.

```yaml
purchase_order:
  x-approval:
    on_approved:
      set_fields:
        - field: status         # target field name on this entity
          value: "1"            # string label (resolved to integer index for Int fields)
```

The generator resolves enum labels to integer indices when the target field type is `integer`,
preventing TypeScript build errors in the generated dispatch file.

#### Schema: `on_approved.emit_hook`

Generates `lib/{entity}/service_after_approve.ts` as a **once-stub** (written only when the file
does not exist; never overwritten by `generate-code` re-runs). This is the safe extension point
for custom post-approval logic.

```yaml
purchase_order:
  x-approval:
    on_approved:
      emit_hook: true
```

Generated stub (`lib/purchase_order/service_after_approve.ts`):

```typescript
import type { Prisma } from "@prisma/client";

type Tx = Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function afterApprove(tx: Tx, approvedId: string) {
  // Custom post-approval logic here.
  // approvedId = the purchase_order record id that was just approved.
}
```

#### Generated `on_approved_dispatch.ts`

```typescript
// lib/purchase_order/on_approved_dispatch.ts  (generated — do not edit)
export async function dispatchOnApproved(tx: Tx, approvedId: string) {
  const record = await tx.approvable.findUnique({
    where: { id: approvedId },
    include: { purchase_order: true },
  });
  if (!record?.purchase_order || record.purchase_order.approvable?.approved_at) return;

  // set_fields
  await tx.purchase_order.update({
    where: { id: record.purchase_order.id },
    data: { status: 1 },
  });

  // set approved_at for idempotency
  await tx.approvable.update({
    where: { id: approvedId },
    data: { approved_at: new Date() },
  });

  // emit_hook
  const { afterApprove } = await import("@/lib/purchase_order/service_after_approve");
  await afterApprove(tx, record.purchase_order.id);
}
```

#### Prisma model change

`approvable` gains `approved_at DateTime?` for idempotency tracking:

```prisma
model approvable {
  id               String             @id @default(cuid())
  approved_at      DateTime?          // set by on_approved_dispatch; prevents re-firing
  approval_requests approval_request[]
}
```

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

`lib/{entity}/on_rejected_dispatch.ts` (generated, `templates/on_rejected_dispatch.ts.jinja2`)
exposes `dispatchOnRejected(tx, entityType, approvableId, rejectedByUserId)`, called from the
reject path after `approval_request.status` is updated, plus `isTerminalReject(entityType)` — a
lookup against every entity marked `terminal: true`. Terminal rejection means the UI's Resubmit
button (§16.8) is not offered for that entity type; a rejection is final rather than
returning to Pending. For terminal entities, dispatch reuses the same `approvable.approved_at`
column as the fire-once guard (§16.9) — despite the name, it just means "final event already
dispatched for this approvable," approve or reject.

`emit_hook: true` generates a `service_after_reject.ts` once-stub (same non-overwriting
convention as `service_after_approve.ts`, §16.9), with signature
`afterReject(tx, entityId, approvableId, rejectedByUserId)`.
