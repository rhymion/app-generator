# Multi-tenancy plan

Forward-looking design for adding multi-tenant support to the app
generator. Sibling to `docs/todo.md` (security backlog) and `docs/plan.md`
(product plan); use this as the source of truth when scoping the
implementation tickets in Phases 1–4 below.

Date drafted: 2026-05-17.


## Goals

1. A `tenant` table exists and is the deployment-level partition (one
   SaaS customer = one tenant).
2. Most generated entities carry a `tenant_id` FK and all reads/writes
   are scoped to the caller's tenant.
3. Per-entity opt-out for reference data (e.g. `currency`, `country`,
   `locale`).
4. Per-deployment opt-out from multi-tenancy entirely. Single-tenant
   deployments pay **zero** runtime cost — no extra columns, no extra
   `where` clauses, no extra index lookups. Enforced by a golden-file
   regression test on generator output.


## Position before the work

- `prisma/schema.prisma:13` already has a stub `tenant` table (`id`,
  optional `name`) — wired to nothing.
- `code_generator/build_context.py:581` already has the **org-level**
  scoping pattern: `should_filter_by_org = has_org_rel and model not in
  ('organization', 'user')`. Templates branch on it in
  `getters.ts.jinja2`. The new tenant work mirrors this exact shape
  one level up.
- Existing org filtering is **read-side only**. The service layer
  assumes the caller has been org-checked upstream. Tenant scoping
  must be read AND write side to be a real security boundary.
- `organization` stays as the existing sub-grouping *within* a tenant.
  Both layers coexist.


## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tenant resolution | `session.user.tenant_id` only | No DNS / cert ops; works with existing Auth.js. Subdomain resolution kept as future via a single chokepoint. |
| User↔tenant | `user.tenant_id` (1:1), behind `getCurrentTenantId()` | Simplest schema. A future `user_tenant` join table is a one-file swap because every consumer goes through the chokepoint function. |
| DB enforcement | App-layer for v1; Postgres RLS deferred | RLS adds connection-pool complexity and ~5–10% on hot queries; only worth it once compliance demands it. |
| Migration | Auto-backfill existing rows to a `default` tenant | Operators get a working multi-tenant deployment from one command. |


## Schema changes (`prisma/schema.prisma`)

- **`tenant` (expand the stub):** `id`, `name` (NOT NULL), `slug` (@unique,
  for human-readable identification), `status` (`active` / `suspended`
  — gates auth), `created_at`, `updated_at`, `creator_id`, `updater_id`.
  The bare stub stays; this just fills it out.
- **`user.tenant_id`** + FK → `tenant(id) onDelete: Restrict` +
  `@@index([tenant_id])`. Cascade is wrong here — deleting a tenant
  by accident should require explicit detachment.
- **All tenant-scoped entities:** `tenant_id String` + FK with
  `onDelete: Cascade` (data dies with the tenant by design) +
  `@@index([tenant_id])`. Where an entity already has compound
  indexes, `tenant_id` becomes the leftmost column (cheapest reject).
- **Opt-out allowlist (no `tenant_id`):** `tenant` itself, `Account` /
  `Session` / `VerificationToken` (Auth.js adapter tables — keyed via
  `user.tenant_id`), and any entity with `x-multi-tenant: false` in
  `json_schema.yaml` (e.g. `currency`, `country`, `locale`).
- **`audit_log.tenant_id`** (nullable — system events without a tenant
  context stay valid; see Risks below for the query-pattern caveat).
- **`organization.tenant_id`** — orgs become tenant-scoped. The
  existing `should_filter_by_org` logic is unchanged; tenant filtering
  wraps around it.


## Generator changes (`code_generator/`)

Mirrors the existing `should_filter_by_org` plumbing, one level up.

1. **New schema config.** Top-level `x-multi-tenant: true|false`
   (default `false`); per-entity `x-multi-tenant: false` to opt out
   individually.
2. **`build_context.py`.** Read the global flag once. For each entity
   compute
   `is_tenant_scoped = global_flag and entity_flag and model not in
   TENANT_SYSTEM_TABLES`. System-table set: `{'tenant', 'Account',
   'Session', 'VerificationToken'}`. Pass through to entity context
   alongside `should_filter_by_org`.
3. **`validate.py`.** When global flag on, extend
   `_REQUIRED_INDEX_COLUMNS` with `tenant_id`. Also assert every
   non-allowlisted model has a `tenant_id String` field — a missed FK
   is a silent multi-tenant escape.
4. **Templates that gain `{% if is_tenant_scoped %}` branches:**
   - `service.ts.jinja2` — every `create`/`update` sets
     `tenant_id: actorTenantId`; every `delete`/`findUnique` adds
     `tenant_id` to `where`. New `actorTenantId: string` param on
     every exported function.
   - `getters.ts.jinja2` — `findFirst({ where: { tenant_id, ... } })`
     for both single and list. Tenant filter is the **first**
     AND-clause (leftmost-index, cheap reject).
   - `api_route.ts.jinja2` / `api_detail_route.ts.jinja2` /
     `api_bulk_route.ts.jinja2` — call `getCurrentTenantId()` once at
     the top, pass through to service / getter.
   - `actions.ts.jinja2` — same pattern as API routes.
   - `form_upsert.tsx.jinja2` — hidden field if needed for create
     flows; otherwise derived server-side.
   - `test_helper.ts.jinja2` — every populate/dep helper writes
     `tenant_id: testTenant.id`; new `getTestTenant()` parallel to
     existing `getTestUser()`, find-or-create on first call.
   - `test_db_helpers.ts.jinja2` — `db:reset` seeds the test tenant.
   - `column_def.tsx.jinja2` and page templates — no change; display
     is unaffected, filter happens upstream.
5. **`cleanup.py`.** No change.


## Tenant resolution & authz (`lib/`)

- **`lib/tenant.ts` (new):** `getCurrentTenantId()` reads
  `session.user.tenant_id`. Single chokepoint; a future migration to
  subdomain resolution or a join-table-with-active-tenant is a
  one-file change.
- **`lib/authz.ts`:** `getSessionUserIdOrThrow()` gets a sibling
  `getSessionTenantIdOrThrow()`. The latter throws if
  `user.tenant_id` is missing OR the tenant's `status !== 'active'`.
- **`auth.ts`:**
  - `session` callback adds `tenant_id` to `session.user` (read from
    DB on first call, then cached in the JWT).
  - `signIn` callback rejects users whose tenant is `suspended`.
    Audit-log as `auth:signIn.reject` with reason `tenant_suspended`.
  - `events.signIn` / audit calls include `tenant_id`.


## Auth.js integration

- **Sign-up:** v1 is invite-only — admin of tenant X creates user
  accounts pre-bound to tenant X. Self-service tenant creation is a
  separate flow, deferred.
- **Account-linking (S7):** unchanged. OAuth links to the same
  `user.id`, so the OAuth `Account` inherits the user's `tenant_id`
  transitively.
- **MFA (S5):** unchanged. Secrets stay on the user row.


## Opt-out & performance guarantee

The load-bearing piece of the design.

- **When `x-multi-tenant: false` (or absent):** `is_tenant_scoped`
  resolves to `false` for every entity → every template branch
  produces **the same source as today** → byte-identical generator
  output. No `tenant_id` columns, no extra `where` clauses, no extra
  index lookups.
- **Enforcement:** `code_generator/tests/test_multi_tenant_optout.py`
  regenerates the demo project with `x-multi-tenant: false` and
  asserts the output matches a checked-in golden under
  `code_generator/tests/golden/single_tenant/`. Any future template
  change that accidentally leaks tenant code into the off path fails
  the test.
- **Why this works:** the existing `should_filter_by_org` plumbing
  already proves the pattern — opted-out entities produce clean code
  with no residue.


## Migration

`code_generator/migrate_to_multi_tenant.py` emits a single ordered
SQL migration:

1. `INSERT INTO tenant (id, name, slug, status, …) VALUES ('default',
   'Default Tenant', 'default', 'active', …);`
2. For each affected table: `ALTER TABLE x ADD COLUMN tenant_id TEXT;`
3. `UPDATE x SET tenant_id = 'default';`
4. `ALTER TABLE x ALTER COLUMN tenant_id SET NOT NULL;`
5. `ALTER TABLE x ADD CONSTRAINT … FOREIGN KEY (tenant_id) REFERENCES
   tenant(id) …;`
6. `CREATE INDEX … ON x (tenant_id);`

Order matters: `tenant` first, then `user.tenant_id`, then everything
else. Steps 3–4 split so the column is nullable during backfill (no
constraint violation on existing data).

Documented one-liner: `npm run migrate:multi-tenant` calls the script
then `prisma migrate dev`.


## Testing

- **Generator pytest:**
  - `tests/test_multi_tenant_context.py` — every entity-flag
    combination + system-table allowlist.
  - `tests/test_multi_tenant_optout.py` — golden-file comparison:
    opt-out output ≡ today's output.
  - `tests/test_multi_tenant_validation.py` — `validate.py` flags
    missing `tenant_id` or missing `@@index([tenant_id])`.
- **Vitest:** `lib/tenant.test.ts`, `lib/authz.test.ts` (new
  `getSessionTenantIdOrThrow`), `auth.test.ts` (suspended-tenant
  rejection).
- **Cypress (cross-tenant isolation):** Tenant A user → tries
  `GET /api/<entity>/<id-from-tenant-B>` → 404 (not 403; existence is
  itself information). Same for list views and mutations.


## Phased ticket breakdown

Sizes: **S** ≤ 150 LOC, **M** 150–400, **L** 400+. Each ticket = one
focused PR with its own gate. Total 13 tickets across Phases 1–4
(5 S, 8 M). Phase 5 listed for future tracking.

### Phase 1 — Schema + tenant model

After Phase 1, single-tenant deployments are unaffected; the
multi-tenant infrastructure exists but is unused.

| # | Ticket | Scope | Size | Depends |
|---|---|---|---|---|
| 1.1 | Expand `tenant` model | `prisma/schema.prisma`: `tenant` gains `name` (NOT NULL), `slug @unique`, `status`, `created_at`, `updated_at`, `creator_id`, `updater_id`. Prisma migration. `db:seed` and test fixtures seed a `default` tenant. | S | — |
| 1.2 | `user.tenant_id` + safe backfill migration | `user.tenant_id String` + FK to `tenant(id) onDelete: Restrict` + `@@index`. Safe 4-step migration (ADD nullable → UPDATE → SET NOT NULL → FK). `auth.ts` `buildAdapter().createUser` sets `tenant_id`. Vitest: createUser writes `tenant_id`. | S | 1.1 |
| 1.3 | `lib/tenant.ts` + `lib/authz.ts` additions | `lib/tenant.ts` exports `getCurrentTenantId()` (chokepoint). `lib/authz.ts`: `getSessionTenantIdOrThrow()` (throws on missing or suspended tenant). Vitest. | S | 1.2 |
| 1.4 | Auth.js tenant-aware callbacks | `auth.ts`: `session` adds `tenant_id` to `session.user`; `jwt` carries it through credentials sign-in; `signIn` rejects suspended tenants (audit-logged). TS module augmentation. `auth.test.ts` cases. | M | 1.3 |
| 1.5 | Auto-migrate script | `code_generator/migrate_to_multi_tenant.py` emits the ordered SQL. `npm run migrate:multi-tenant`. Pytest: ordering, idempotency. | M | 1.1 |

### Phase 2 — Generator opt-out plumbing + perf guarantee

Lands as a pair: the second ticket proves the first didn't regress.

| # | Ticket | Scope | Size | Depends |
|---|---|---|---|---|
| 2.1 | Plumb `x-multi-tenant` flag (always off) | `json_schema.yaml` top-level + per-entity flag. `build_context.py`: read flag, compute `is_tenant_scoped` per entity (returns false today since templates don't branch yet). Thread through to context. Pytest: flag plumbing returns expected booleans for the allowlist. | S | — |
| 2.2 | Golden-file opt-out regression test | `tests/test_multi_tenant_optout.py` + checked-in `tests/golden/single_tenant/`. Regenerate with `x-multi-tenant: false`, assert file-for-file equality. Any future template change that leaks tenant code into the off path fails. | M | 2.1 |

### Phase 3 — Generator on path

Split per template so each PR is reviewable.

| # | Ticket | Scope | Size | Depends |
|---|---|---|---|---|
| 3.1 | `build_context.py` + `validate.py`: full on path | `is_tenant_scoped` real evaluation with system-table allowlist. `validate.py`: when global flag on, every non-allowlisted model must have `tenant_id` field + `@@index([tenant_id])`. Pytest covers all combinations. | M | 2.2 |
| 3.2 | Template: `service.ts.jinja2` | `actorTenantId: string` param. `create`/`update`/`upsert` set `tenant_id`. `delete`/`findUnique` add `tenant_id` to `where`. Pytest. | M | 3.1 |
| 3.3 | Template: `getters.ts.jinja2` | `tenantId` param. `tenant_id` is the first AND-clause in every where. Pytest. | M | 3.1 |
| 3.4 | Templates: api routes + actions | `api_route.ts.jinja2`, `api_detail_route.ts.jinja2`, `api_bulk_route.ts.jinja2`, `actions.ts.jinja2`: call `getCurrentTenantId()` once, thread through. Pytest. | M | 3.2, 3.3 |
| 3.5 | Templates: test helpers + db helpers | `test_helper.ts.jinja2`: `getTestTenant()`, every populate sets `tenant_id`. `test_db_helpers.ts.jinja2`: `db:reset` seeds the test tenant. Pytest. | M | 3.2 |
| 3.6 | Per-entity opt-out + docs | `docs/knowledge/multi-tenancy.md` reference (separate from this plan): per-entity flag, allowlist, security model, migration. One opt-out entity in the demo schema as an example. Pytest validates the opt-out entity emits no `tenant_id` code. | S | 3.1 |

### Phase 4 — Auth + cross-tenant isolation

| # | Ticket | Scope | Size | Depends |
|---|---|---|---|---|
| 4.1 | Invite-only sign-up | Admin-gated `/api/auth/invite` endpoint or server action — creates a user pre-bound to the current admin's tenant. `/register` disabled or gated to invite token. Vitest. | M | 1.4 |
| 4.2 | `audit_log.tenant_id` everywhere | `audit_log.tenant_id String?` (nullable) + index. Migration. `recordAuditEvent` signature gains optional `tenant_id`; defaults from `getCurrentTenantId()`. Update callers in `auth.ts` + generated service hooks (generator template change for the service hook is the only template touched). Vitest. | M | 3.4 |
| 4.3 | Cross-tenant isolation cypress suite | New `cypress/e2e/multi_tenant_isolation.cy.ts` (hand-written — too cross-cutting for the generator). Two-tenant fixture: Tenant A user GETs/PUT/DELETEs Tenant B's resource by id → 404. Includes list, detail, mutation paths. | M | 3.4 |


## Sequencing

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
  1.1                     3.1          4.1   (needs 1.4)
  1.2 (after 1.1)         3.2          4.2   (needs 3.4)
  1.3 (after 1.2)         3.3          4.3   (needs 3.4)
  1.4 (after 1.3)         3.4 (after 3.2,3.3)
  1.5 (after 1.1)         3.5 (after 3.2)
                          3.6 (after 3.1)
```

Estimate: ~3 weeks of focused work sequentially. Within Phase 3,
tickets 3.2 / 3.3 / 3.5 / 3.6 are independent after 3.1 and can
parallelise.


## Out of scope (future)

| # | Item | Why deferred |
|---|---|---|
| 5.1 | Postgres RLS as defense-in-depth | Pays a perf + ops cost; only worth it once compliance demands it. App-layer enforcement covers v1. |
| 5.2 | Subdomain tenant resolution | Needs wildcard DNS + cert ops; `getCurrentTenantId()` chokepoint makes this a one-file swap when needed. |
| 5.3 | `user_tenant` join table | Single-tenant users cover the common case; multi-tenant users is a separate feature with its own UX. |
| 5.4 | Per-tenant rate limits | Current proxy limits are per-IP; per-tenant requires tenant resolution before auth — separate piece. |
| 5.5 | Tenant-scoped feature flags / plan tiers | Product feature, not infrastructure. |
| 5.6 | Cross-tenant superadmin dashboard | Bypasses the boundary Phase 4 enforces; needs its own access model. |


## Risks to resurface during implementation

- **Phase 1.2 / 1.5:** the backfill migration touches every existing
  row. Test on a copy of prod-shaped data before shipping the script.
- **Phase 3.4:** first time generated write-side code gates on
  something beyond `userId`. Review the service signature ripple at
  this point — if it gets ugly, that's the signal to refactor before
  continuing.
- **Phase 4.2:** `audit_log.tenant_id` nullable means tenant-scoped
  audit queries need `WHERE tenant_id = $1 OR tenant_id IS NULL`.
  Document the pattern in the audit-log reference.
- **`organization.tenant_id` is a chained constraint** — an
  `organization` row's `tenant_id` must match every row that
  references that org's `organization_id`. The validator should warn
  (not error) when a generated entity has both a `tenant_id` and an
  `organization_id` FK so the schema author can confirm consistency.
