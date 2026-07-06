---
description: Multi-tenancy review — tenant filter coverage, data leak paths, cross-tenant operations.
argument-hint: <scope or model to review>
---

This is a **tenancy review** task. Read the relevant source files carefully before evaluating.

Scope: $ARGUMENTS (if empty, review all generated queries and API routes)

Minimum docs to read before starting:
- `docs/knowledge/multi-tenancy-and-permissions.md` — tenant isolation, auth/authz system

Note: `docs/multi-tenancy.md`, referenced below by phase number (e.g. "Phase 1.3"),
was removed as a planning doc in commit b11269b. Its content is not superseded by
anything in-repo; recover it via `git show b11269b^:docs/multi-tenancy.md` if you
need the full phase-by-phase plan.

## How to run this review

1. Read the relevant source files (schema, generated API routes, middleware).
2. Check each item in the checklist below.
3. For each item: cite specific `file:line` evidence.

## Checklist

### Tenant filter coverage

- [ ] All generated Prisma queries include tenant filtering in `where` clause
  — **CURRENTLY FAILING**: `getters.ts.jinja2` has no `tenant_id` branch; generated `get{Entity}Page`/`get{Entity}Detail` use only RBAC (Creator/Assignee) filters, no `tenant_id: tenantId` in the Prisma `where` clause. Phases 3.3/3.4 from `docs/multi-tenancy.md` are pending.
- [ ] Generated write paths (create/update/delete) scope to the actor's tenant
  — **CURRENTLY FAILING**: `actions.ts.jinja2` and `service.ts.jinja2` (not yet templated) do not call any `getCurrentTenantId()` equivalent; `tenant_id` is never written on entity create or filtered on update/delete. Phase 3.2 is pending.
- [ ] `lib/tenant.ts` `getCurrentTenantId()` chokepoint exists and is used by generated code
  — **CURRENTLY MISSING**: `lib/tenant.ts` does not exist. Phase 1.3 from `docs/multi-tenancy.md` is pending. Without this chokepoint all generated code would need ad-hoc `auth()` calls to retrieve the tenant.
- [ ] `json_schema.yaml` `x-multi-tenant` flag plumbed through `build_context.py`
  — **CURRENTLY MISSING**: `build_context.py` has no `is_tenant_scoped` computation. Phase 2.1 is pending. Until this lands, the generator cannot conditionally emit tenant-scoped code.

### Data leak paths

- [ ] `GET /api/{entity}/{id}` cannot return a row owned by a different tenant
  — **GAP**: `api_detail_route.ts.jinja2` generates `prisma.{model}.findUnique({ where: { id } })` with no `tenant_id` in the where clause (`code_generator/templates/api_detail_route.ts.jinja2:~20`). An actor with a valid API key and `read` permission could retrieve any row by id, across tenants.
- [ ] `GET /api/{entity}` list cannot return rows from other tenants
  — **GAP**: `api_route.ts.jinja2` routes to `get{Entity}Page(opts, richPerms, actorId)`. The `buildEntityAccessWhere()` in `getters.ts.jinja2` adds RBAC filters (Creator/Assignee) but no `tenant_id` filter (`code_generator/templates/getters.ts.jinja2:~24–42`). RBAC misconfiguration (e.g. a role with `general.read = true`) silently exposes all tenants' rows.
- [ ] UI Server Actions cannot leak cross-tenant rows
  — **GAP**: `actions.ts.jinja2` calls `get{Entity}DetailPageData(id)` → `get{Entity}Detail(id)` → `prisma.{model}.findUnique({ where: { id } })`. Same root cause as the API gap above.

### Cross-tenant operations

- [ ] `PUT /api/{entity}/{id}` update scoped to actor's tenant
  — **GAP**: `api_detail_route.ts.jinja2` PUT handler calls `prisma.{model}.findUnique({ where: { id } })` to fetch `existing` for permission check, with no `tenant_id` filter. An actor could update a row belonging to another tenant if they know the `id` and have role-level `update` permission.
- [ ] `DELETE /api/{entity}/{id}` delete scoped to actor's tenant
  — **GAP**: Same template, same pattern as PUT. `delete{Entity}([id])` is called without a tenant guard.
- [ ] `tenant.status = 'suspended'` blocks all sign-ins for that tenant's users
  — **CURRENTLY NOT ENFORCED**: `tenant.status` column exists in `prisma/schema.prisma` (line ~24) but the `auth.ts:signIn()` callback does not query `tenant.status` for the signing-in user. Phase 1.4 from `docs/multi-tenancy.md` is pending.

### API route tenant scope

- [ ] `app/api/approval_request/[id]/approve/route.ts` scoped to actor's tenant
  — `approval_request` rows are fetched with `prisma.approval_request.findUnique({ where: { id } })` and no `tenant_id` in the where (`app/api/approval_request/[id]/approve/route.ts:13`). The approver role check guards against unauthorized approvals but not cross-tenant reads.
- [ ] `app/api/notifications/route.ts` scoped to actor's tenant
  — Notifications are filtered only by `userId` from `authenticateApiKey()`; no `tenant_id` filter. All notifications for a user across tenants would be returned if the user migrated tenants (does not apply to the current single-tenant deployment but will at Phase 3+).
- [ ] Session `tenant_id` propagated in JWT for downstream use
  — **CURRENTLY MISSING**: `auth.ts:session()` callback only forwards `user.id` into `session.user`; `tenant_id` is not added. Phase 1.4 is pending. Without this, any call to `auth()` cannot determine the caller's tenant without an extra DB lookup.

## Current implementation (proj_a specific)

**Schema state (Phase 1.1 + 1.2 complete):** `prisma/schema.prisma` has a fully modelled `tenant` table (id, name, slug @unique, status, created_at, updated_at, creator_id, updater_id). `user.tenant_id String @default("default")` FK → `tenant(id) onDelete: Restrict` with `@@index([tenant_id])`. The bootstrap `"default"` tenant is seeded by `scripts/seed-its.ts`.

**User creation (Phase 1.2 partial):** `lib/auth/create-user.ts:createTenantBoundUser` always writes `tenant_id = "default"` (`DEFAULT_TENANT_ID = "default"`) for OAuth users created via the PrismaAdapter. This is intentionally single-tenant until Phase 4.1 (invite-based sign-up) is implemented.

**Generated entity scope (Phase 3 NOT YET STARTED):** The ~30+ generated entity models (bug, character, checkup, clinic, creator, dashboard, epic, feature, funding, leave_request, etc. — see `lib/` directories) carry **no `tenant_id` field** in their Prisma models. This means the DB has no structural constraint preventing cross-tenant reads. All isolation for these models is RBAC-only, enforced in `lib/authz.ts:requirePermission()`/`requireApiPermission()`.

**Generator readiness (Phase 2 NOT YET STARTED):** `code_generator/build_context.py` has no `is_tenant_scoped` variable. `json_schema.yaml` has no `x-multi-tenant` flag. Generator templates (`getters.ts.jinja2`, `api_route.ts.jinja2`, `api_detail_route.ts.jinja2`, `api_bulk_route.ts.jinja2`, `actions.ts.jinja2`) have no `{% if is_tenant_scoped %}` branches. The detailed implementation plan is in `docs/multi-tenancy.md` (Phases 2–4).

**`lib/tenant.ts`:** Does not exist. The chokepoint function `getCurrentTenantId()` described in `docs/multi-tenancy.md:Phase 1.3` has not been implemented. `lib/authz.ts` exports `getSessionUserIdOrThrow()` but no tenant-equivalent.

## Known gaps / improvement areas

- **No tenant filter in any generated query** — this is the highest-risk gap. A correctly permissioned user (role with `general.read = true`) can read rows from any tenant. The fix is Phase 3: add `is_tenant_scoped`, add `tenant_id` to entity schemas, add tenant WHERE clause as the first AND in `buildEntityAccessWhere()`.
- **`tenant.status` suspension not enforced at sign-in** — `auth.ts:signIn()` callback does not query `tenant.status`. A suspended tenant's users can still authenticate. Fix: Phase 1.4 — add a `prisma.user.findUnique` in `signIn()` that joins or follows `user.tenant.status` and returns `false` on `suspended`.
- **`session.user.tenant_id` not propagated** — the JWT does not carry `tenant_id`. Server Actions and API routes that need the tenant must do a redundant DB lookup. Fix: Phase 1.4 — add `tenant_id` to the `session` and `jwt` callbacks, and extend the TS module augmentation.
- **`lib/tenant.ts` chokepoint missing** — without a single `getCurrentTenantId()` function all generated code will need bespoke patterns. Implement Phase 1.3 before starting Phase 3 template work.
- **No cross-tenant isolation Cypress tests** — `cypress/e2e/` has no suite verifying that Tenant A's user cannot read or mutate Tenant B's rows. Phase 4.3 specifies `multi_tenant_isolation.cy.ts` with a two-tenant fixture. Until then, regression coverage for the isolation invariant is zero.
- **`audit_log` has no `tenant_id`** — admin audit queries cannot filter by tenant. Fix is Phase 4.2. Until then, a superadmin-level audit query returns events from all tenants interleaved.

> **Note**: When running lint or typecheck in isolation, prefix with
> `npm run generate-code` first. See `AGENTS.md §Generated-code prerequisites
> for gates` for the full rule.
