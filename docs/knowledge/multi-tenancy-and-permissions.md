# Multi-tenancy and Permissions

This document describes how the app-generator handles tenant isolation at the organization level and how the role-based permission system controls access to data.

Note: `docs/multi-tenancy.md`, referenced below by phase number, was removed
as a planning doc in commit b11269b. Its content is not superseded by
anything in-repo; recover it via `git show b11269b^:docs/multi-tenancy.md`
if you need the full phase-by-phase plan or the "Decisions" rationale.

---

## 1. Organization-based tenant isolation

### Overview

The app uses **two** scoping layers:

| Layer | Model | Scope |
|---|---|---|
| Deployment-level | `tenant` | One SaaS customer = one tenant (Phases 1–4 of `docs/multi-tenancy.md` — not yet fully wired into generated code) |
| Application-level | `organization` | Sub-grouping of users within a deployment; currently active in generated queries |

In practice today, **organization** is the active isolation boundary that generated code enforces. The `tenant` model exists in `prisma/schema.prisma` and `user.tenant_id` is populated, but tenant-level scoping in generated service/getter code is deferred to the multi-tenancy roadmap.

### Schema structure

```prisma
// prisma/schema.prisma

model tenant {
  id     String @id @default(cuid())
  name   String
  slug   String @unique
  status String @default("active")  // "active" | "suspended"
  users  user[] @relation("UserTenant")
}

model user {
  tenant_id String  @default("default")
  tenant    tenant  @relation("UserTenant", fields: [tenant_id], references: [id], onDelete: Restrict)
  organizations organization[] @relation("UserOrganizations")
  ...
}

model organization {
  id    String @id @default(cuid())
  name  String
  users user[] @relation("UserOrganizations")
  ...
}
```

The `organization` model is a many-to-many join: a user belongs to zero or more organizations, and an entity's `organization_id` field points to exactly one organization.

### Which models are org-scoped

An entity gets automatic org-scoped filtering when both conditions hold:

1. The entity has an `organization_id` FK field pointing to `organization` (declared in `code_generator/json_schema.yaml` via `x-relationship`)
2. The model name is NOT `organization` or `user`

This is computed in `code_generator/build_context.py:1707-1708` (line numbers have
shifted since this doc was written as the file grew; the logic itself is unchanged):

```python
has_org_rel          = any(r['target'] == 'organization' for r in parent_rels)
should_filter_by_org = has_org_rel and model not in ('organization', 'user')
```

The `should_filter_by_org` flag is threaded into every generated getter and API route for that entity.

### How filtering is applied in Prisma where clauses

For an entity with `should_filter_by_org = True`, the generated `lib/{entity}/getters.ts` (from `code_generator/templates/getters.ts.jinja2`) inserts an `organization_id` filter into every query:

```typescript
// Generated: lib/{entity}/getters.ts
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

const associatedOrganizations = await getAssociatedOrganizations(userId);
const associatedOrganizationIds = associatedOrganizations.map((o) => o.id);

// findFirst (not findUnique) for detail queries when org-scoped
const item = await prisma.{model}.findFirst({
  where: {
    id,
    organization_id: { in: associatedOrganizationIds },
  },
});
```

For list queries, `build{Entity}AccessWhere()` adds the org filter as the first AND clause:

```typescript
function build{Entity}AccessWhere(perms, userId, associatedOrganizationIds) {
  const and = [];
  and.push({ organization_id: { in: associatedOrganizationIds } });   // org gate
  if (!perms.general.read) {
    // creator / assignee fallback ...
  }
  return and;
}
```

`getAssociatedOrganizations(userId)` is defined in `lib/organization/getters_associated.ts` and fetches only organizations the user is a member of:

```typescript
await prisma.organization.findMany({
  where: { users: { some: { id: userId } } },
});
```

### Org-scoped filtering trigger conditions

The filter activates when ALL of the following are true at code-generation time:

- The entity's JSON schema definition includes an `organization_id` property with `x-relationship: { type: 'many-to-one', target: 'organization' }`
- The model name is not `organization` or `user`
- The `organization_id` field has an `@@index([organization_id])` in `prisma/schema.prisma` (enforced by `validate.py`'s `_REQUIRED_INDEX_COLUMNS` check, `code_generator/validate.py:40`/125-153 — not line 21 as an earlier version of this doc had it; line numbers have shifted as the file grew)

At runtime, the filter is always applied — there is no per-request bypass.

---

## 2. Permission and authorization system

### Core types (`lib/authz.ts`)

```typescript
// lib/authz.ts

export type Operation = 'create' | 'read' | 'update' | 'delete' | 'import';
export type OperationFlags = Record<Operation, boolean>;

export interface RichPermissions extends OperationFlags {
  general:  OperationFlags;           // from global + non-special roles
  creator:  OperationFlags | null;    // null = no Creator role defined
  assignee: OperationFlags | null;    // null = no Assignee role defined
}
```

**Update**: `Operation` gained a fifth member, `'import'`, since this doc was written
(`lib/authz.ts:23`) — `OperationFlags` is now five boolean flags, not four (the
in-code comment on the adjacent `ModelPermissions` type alias still says "four", which
is itself stale, but that's a source-code comment, not this doc's claim to fix). The
`import` flag is checked via `assertPermission(permissions, 'import', ...)` in CSV
import routes (`api_import_route.ts.jinja2`) — a distinct permission from `create`,
gating whether a user may bulk-import rows even if they can't otherwise create them
one at a time (or vice versa). `RichPermissions` adds sub-objects for item-level
resolution as before.

### `getModelPermissions()` — the entry point

```typescript
// lib/authz.ts:151 (line shifted since this doc was written; was 141)
export const getModelPermissions = cache(async (
  model: ModelName,
  userId?: string | null,
): Promise<{ permissions: RichPermissions; userId: string | null }>
```

This function:

1. Resolves `userId` from the session if not provided
2. Checks a per-process TTL LRU cache (production only, 30s TTL, 1000 entries)
3. Queries `prisma.permission.findMany()` with three OR branches:
   - `role_id: null` — global permissions (no role attached)
   - User's non-special roles
   - All `Creator` and `Assignee` role definitions (fetched for deferred item-level resolution)
4. Merges flags into `general`, `creator`, `assignee` sub-objects

**Default deny**: if no permission rows match the model at all, `deriveRichPermissionsFromRows` returns all-false flags, so every operation is denied. A new entity is unusable until a role is granted permission rows for it (see [authorization-default-deny.md](authorization-default-deny.md)); the only exceptions are the read-only shortcuts for the `Administrator` role on `audit_log` and on `x-self-only` entities with `admin_bypass: true`.

### Creator and Assignee roles

Two role names are treated specially: `Creator` and `Assignee` (defined in `lib/authz.ts:57` as `SPECIAL_ROLE_NAMES` — line shifted since this doc was written; was 30).

These roles grant item-level access — they apply only to records the user created or is assigned to, not to all records of that type.

Top-level flags on `RichPermissions` (without item context) include these roles so that `assertPermission` passes on list pages for Creator/Assignee-only users. This is by design — a user who can only see their own records still needs `read: true` to reach the list page.

### `resolvePermissions()` — item-level resolution

```typescript
// lib/authz.ts:79 (line shifted since this doc was written; was 72)
export async function resolvePermissions(
  perms: RichPermissions,
  item: ItemContext,   // { creator_id?, assignee_id?, ... } | null
  userId: string,
): Promise<RichPermissions>
```

Called after fetching a specific record to compute the accurate effective permissions for that item:

```typescript
if (item.creator_id === userId && perms.creator) {
  read   = read   || perms.creator.read;
  update = update || perms.creator.update;
  del    = del    || perms.creator.delete;
}
if (item.assignee_id === userId && perms.assignee) {
  read   = read   || perms.assignee.read;
  update = update || perms.assignee.update;
  del    = del    || perms.assignee.delete;
}
```

`create` is never granted by Creator/Assignee roles — creation is a model-level operation, not item-level.

### `requirePermission()` and `assertPermission()`

```typescript
// lib/authz.ts:296 — throws Error("Access denied: model.operation") (line shifted; was 245)
export async function requirePermission(
  model, operation, item?, userId?,
): Promise<RichPermissions>

// lib/authz.ts:312 — same but takes pre-fetched permissions (line shifted; was 261)
export async function assertPermission(
  permissions: OperationFlags, operation, model?,
): Promise<void>
```

Both throw `Error("Access denied: {model}.{operation}")`. API routes catch this via `requireApiPermission()` in `lib/api-auth.ts:132` (line shifted since this doc was written; was 86) and convert it to a 403 response.

### Permission cache

Permission checks always read the current database state; nothing is cached across requests, so a revoked permission or role change takes effect on the next request in every instance. Within one request, `memoizeInRequestScope` (and React `cache()` in render trees) deduplicates repeated checks for the same user and model.

`getModelPermissions('my_entity', userId)` grants or denies CRUD at the model level. There is no mechanism to restrict which fields a user may read or write within a model.

### API key cache has a 5-minute lag

Rotating a user's `api_key` does not immediately invalidate the old key in the cache. The old key remains valid for up to 5 minutes in production. `invalidateApiKeyCache(oldKey)` from `lib/api-auth.ts` should be called in account-update endpoints.

### No approval-flow permission integration

The `approval_request` / `approval_flow` system (`prisma/schema.prisma: approval_flow, approval_request, approval_history`) operates separately from `getModelPermissions`. Approval-gated operations must be checked in custom service hooks (`lib/{entity}/service_after_create.ts`) — there is no automatic bridge between the two systems.
