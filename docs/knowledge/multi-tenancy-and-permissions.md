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

This is computed in `code_generator/build_context.py:596-597`:

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
- The `organization_id` field has an `@@index([organization_id])` in `prisma/schema.prisma` (enforced by `validate.py`, `code_generator/validate.py:21`)

At runtime, the filter is always applied — there is no per-request bypass.

---

## 2. Permission and authorization system

### Core types (`lib/authz.ts`)

```typescript
// lib/authz.ts

export type Operation = 'create' | 'read' | 'update' | 'delete';
export type OperationFlags = Record<Operation, boolean>;

export interface RichPermissions extends OperationFlags {
  general:  OperationFlags;           // from global + non-special roles
  creator:  OperationFlags | null;    // null = no Creator role defined
  assignee: OperationFlags | null;    // null = no Assignee role defined
}
```

`OperationFlags` is the four boolean flags. `RichPermissions` adds sub-objects for item-level resolution.

### `getModelPermissions()` — the entry point

```typescript
// lib/authz.ts:141
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

**Default grant**: if no permission rows match the model at all, all four operations are granted. This is the "no explicit deny" default that lets new entities work without first configuring permissions.

### Creator and Assignee roles

Two role names are treated specially: `Creator` and `Assignee` (defined in `lib/authz.ts:30` as `SPECIAL_ROLE_NAMES`).

These roles grant item-level access — they apply only to records the user created or is assigned to, not to all records of that type.

Top-level flags on `RichPermissions` (without item context) include these roles so that `assertPermission` passes on list pages for Creator/Assignee-only users. This is by design — a user who can only see their own records still needs `read: true` to reach the list page.

### `resolvePermissions()` — item-level resolution

```typescript
// lib/authz.ts:72
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
// lib/authz.ts:245 — throws Error("Access denied: model.operation")
export async function requirePermission(
  model, operation, item?, userId?,
): Promise<RichPermissions>

// lib/authz.ts:261 — same but takes pre-fetched permissions
export async function assertPermission(
  permissions: OperationFlags, operation, model?,
): Promise<void>
```

Both throw `Error("Access denied: {model}.{operation}")`. API routes catch this via `requireApiPermission()` in `lib/api-auth.ts:86` and convert it to a 403 response.

### Permission cache

Two layers of caching are in place (production-only, gated by `process.env.NODE_ENV === 'production'`):

| Cache | TTL | Scope |
|---|---|---|
| React `cache()` | Per request | Deduplicates concurrent calls within one render |
| `TtlLruCache` (`lib/_ttl_lru.ts`) | 30 seconds, 1000 entries | Per-process; spans multiple requests |

The cache can be manually invalidated via `invalidatePermissionCache()` from `lib/authz.ts`. Role-mutation endpoints should call this to avoid stale grants within the TTL window.

---

## 3. API route auth patterns

### Session authentication (browser clients)

All browser-facing routes authenticate via NextAuth session. The session cookie is issued by `/api/auth/[...nextauth]/route.ts` and verified with `auth()` from `@/auth`.

```typescript
// Example: app/api/notifications/route.ts
import { getSessionUserId } from '@/lib/authz';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ...
}
```

`getSessionUserId()` (`lib/authz.ts`) wraps `auth()` with React `cache()` to deduplicate session lookups within a single render.

### API key authentication (external integrations)

Machine clients use the `X-API-Key` header (or `Authorization: Bearer <key>`):

```typescript
// lib/api-auth.ts
export async function authenticateApiKey(request: NextRequest): Promise<{ userId: string }>
```

The API key is looked up against `user.api_key` in the DB. A TTL LRU cache (5 min, 1000 entries) reduces DB load. The cache is gated to production (`process.env.NODE_ENV === 'production'`) so Cypress test resets do not encounter stale entries.

### Full API route pattern with permission check

```typescript
// Generated API route pattern (from api_route.ts.jinja2 + api-auth.ts)
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'my_entity', 'read');
    // ... fetch and return data
  } catch (error) {
    return handleApiError(error);   // ApiError → 401/403; other → 500
  }
}
```

`requireApiPermission` (`lib/api-auth.ts:82`) calls `requirePermission` with the resolved `userId` and wraps any `Error("Access denied: ...")` into `ApiError(403, ...)`.

### Middleware protection

The project does **not** have a `middleware.ts` at the project root. Route-level auth is enforced inside each API handler and server action — there is no middleware-layer blanket rejection of unauthenticated requests. Protection depends entirely on each handler calling `getSessionUserId()` or `authenticateApiKey()`.

---

## 4. Org-scoped filtering — when it fires

The org filter is injected at **generation time** (not at runtime configuration). An entity either always has org filtering or never does, based on its schema definition.

Conditions that activate the filter:

```yaml
# code_generator/json_schema.yaml
my_entity_detail:
  properties:
    organization_id:
      type: string
      x-relationship:
        type: many-to-one
        target: organization   # ← this triggers should_filter_by_org
```

Plus:
- `organization_id @@index` present in `prisma/schema.prisma` (validated by `validate.py`)
- Model name is not `organization` or `user`

At runtime the filter fires on every list and detail read for that entity. There is no opt-out path per request.

---

## 5. Current limitations

### App-level filtering, not database-level

Org-based isolation is enforced by Prisma `where` clauses inside generated getters, not by Postgres row-level security (RLS). A bug in the application layer — e.g., a hand-written query that omits the org filter — would silently expose cross-organization data. The `check_generated.py` tool (`code_generator/check_generated.py`) guards against direct `prisma.<model>.write` calls outside the service layer, but cannot guarantee the where clauses in custom code are correct.

See `docs/multi-tenancy.md` § "Decisions" for the rationale (app-layer for v1, RLS deferred until compliance requires it).

### Tenant-level scoping is not yet in generated code

`user.tenant_id` exists and is populated, but the generated getters and services do not yet filter on `tenant_id`. All tenant-aware isolation work is in the roadmap (Phases 2–4 of `docs/multi-tenancy.md`). Currently, users from different tenants sharing the same deployment could see each other's data if they happen to be in the same organization — or if the entity is not org-scoped.

### Permission granularity is model-level, not field-level

`getModelPermissions('my_entity', userId)` grants or denies CRUD at the model level. There is no mechanism to restrict which fields a user may read or write within a model.

### Permission cache does not invalidate on role change

When an admin modifies a user's roles, the permission cache entry for that user persists until its 30-second TTL expires. During this window, the user may still see stale permissions. Call `invalidatePermissionCache()` from `lib/authz.ts` in role-mutation endpoints to tighten this bound.

### API key cache has a 5-minute lag

Rotating a user's `api_key` does not immediately invalidate the old key in the cache. The old key remains valid for up to 5 minutes in production. `invalidateApiKeyCache(oldKey)` from `lib/api-auth.ts` should be called in account-update endpoints.

### No approval-flow permission integration

The `approval_request` / `approval_flow` system (`prisma/schema.prisma: approval_flow, approval_request, approval_history`) operates separately from `getModelPermissions`. Approval-gated operations must be checked in custom service hooks (`lib/{entity}/service_after_create.ts`) — there is no automatic bridge between the two systems.
