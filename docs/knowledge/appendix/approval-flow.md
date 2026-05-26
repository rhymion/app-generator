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
    → revalidates path
```
