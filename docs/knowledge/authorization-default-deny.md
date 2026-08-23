# Authorization: Default-Deny Permission Model

## Principle

The authorization system uses **default-deny**: a user with no explicit permission records is
denied all CRUD operations on every model. Access is only granted through explicit role-based
permission records.

## Role-Permission Model

Permissions are defined per-model, per-role. The schema:

```
role (name, users[])
  └── permission (name=entity, role_id, create, read, update, delete)
```

A user's effective permissions are computed by:
1. Collecting all `permission` rows for their roles (excluding special roles on list pages).
2. OR-merging flags across all matching rows.
3. If **no rows match** → all flags default to `false` (deny all).

Special roles `Creator` and `Assignee` are resolved at item level: they only grant
`read`/`update`/`delete` on items the user owns or is assigned to, never `create`.

## seed-baseline.ts Role

`scripts/seed-baseline.ts` seeds an `Administrator` role with full CRUD on 8 entities:

```
user, role, organization, permission, setting,
approval_request, approval_flow, dashboard
```

Plus a 9th, read-only permission row on `audit_log` (create/update/delete: false).

This is a **fixed enumeration, not schema-derived**: consumer-added entities
(see "Adding Tests for a New Entity" below) are never in this list, so the
seeded `Administrator` role starts with zero permissions on them until an
admin explicitly grants them via the Permissions UI — a deliberate
least-privilege-by-default boundary, not a bug. See
`docs/knowledge/seed-baseline-credential-hardening.md` §"Fixed permission
enumeration" for the full rationale, plus that doc's credential-hardening
change (production provisioning now requires `SEED_ADMIN_EMAIL`/
`SEED_ADMIN_PASSWORD` and mints a random `api_key`, instead of the fixed
`admin@example.com`/`password123`/literal-`api_key` defaults below staying
usable in production).

Only the admin account (`admin@example.com`) receives this role by default. New users start
with zero permissions until an Administrator explicitly assigns roles.

## Test 3-Category Classification

All tests fall into one of three categories:

| Category | Description | Permission setup |
|----------|-------------|------------------|
| **1. Normal-flow** | CRUD operations, page rendering | Call `grantAllEntityPermissions()` / `cy.task('db:grantAllPermissions')` after seed |
| **2. No-permission** | Verifies deny behavior (403/access denied) | No grant needed; test user has no roles by default |
| **3. Permission-independent** | Login/registration, pure UI | No permission setup needed |

### Category assignments (current tests)

**Cypress E2E:**
- `cypress/e2e/auth.cy.ts` → **Category 3** (login/register, no CRUD)
- `cypress/e2e/mobile/layout.cy.ts` → **Category 1** (navigates to `/role` page)

**Vitest unit/component tests:**
- All tests in `lib/`, `components/`, `app/`, `auth.test.ts`, `test/flows/` → **Category 3**
  (use mocked Prisma, never touch the real authz layer)
- `lib/authz.test.ts` → **Category 2** (explicit no-permission and deny assertions)

## Adding Tests for a New Entity

When adding a new **default** entity to `code_generator/json_schema.yaml` (app-generator, the
generator's own baseline schema):

1. Add the entity name to `ALL_ENTITIES` in `cypress/support/db-helpers.ts`.
2. Also add it to `scripts/seed-baseline.ts` entities array.
3. For new Cypress normal-flow tests: use `cy.task('db:grantAllPermissions')` in `beforeEach`.

Consumer/project-specific entities (defined in a consuming project's own `prj/code_generator/
json_schema.yaml`, e.g. `leave_request`) must **not** be added to `scripts/seed-baseline.ts` —
that file is generator-owned and shared by every consumer. Project-specific fixture data
belongs in the consuming project's own test helpers/tasks (see `prj/cypress/support/
project-tasks.ts`), not the shared seed script.
4. For API-level no-permission tests: add cases to `lib/authz.test.ts`.

## Existing Test Refactoring Guide

If a test was written before the default-deny change and now fails with access denied:

1. Determine if it is a normal-flow test (Category 1).
2. Add `cy.task('db:grantAllPermissions')` after `cy.task('db:seed')` in `beforeEach`.
3. For Vitest integration tests hitting a real DB: call `grantAllEntityPermissions()` from
   `cypress/support/db-helpers.ts` (or create an equivalent helper in `test/helpers/`).

## seed/grant vs Generated Test Expected Value Design

### Problem

`db:seed` and `db:grantAllPermissions` pre-populate rows in the `role`, `permission`, and
`user` tables before any user data is inserted. This means that the generated "1.1 returns
empty page" and "1.2 returns page with items" tests cannot expect 0 / 1 rows for these
specific entities.

### What each hook inserts

| Entity     | Inserted by        | Count                                 |
|------------|-------------------|---------------------------------------|
| `role`      | `grantAllPermissions` | 1 ("Administrator")                |
| `permission`| `grantAllPermissions` | N (1 per base entity in schema)    |
| `user`      | `seedTestDatabase`    | 1 (test user)                      |
| all others  | neither               | 0                                  |

N = number of base entities in `code_generator/json_schema.yaml` (entities without `_detail`
or `_input` suffix that have `type: object` and an `id` property).

### Solution: parameterized `seed_count` in the generator

`code_generator/generators_test.py` → `api_spec_context()` computes a `seed_count` per
entity:
- `role` → `seed_count = 1`
- `permission` → `seed_count = N` (counted from schema at generation time)
- `user` → `seed_count = 1`
- all others → `seed_count = 0`

`code_generator/templates/test_api_spec.cy.ts.jinja2` uses `seed_count` to adjust tests:
- **Test 1.1**: when `seed_count == 0` → expects empty rows; otherwise expects `seed_count` rows
- **Test 1.2**: always expects `seed_count + 1` rows after `db:populateX, 1`

### user entity: hidden Prisma-required fields

`user_detail.x-generate.fields = [name, image, roles]` omits `email`, but Prisma requires it
(NOT NULL + UNIQUE). The generator's `helper_context()` now computes `extra_prisma_fields` —
required schema fields not in the UI fields list — and includes them in `prisma.create()` data
for populate helpers. For `user`, this adds:

```typescript
email: `test-${i}-${Date.now()}@example.com`,
```

### Maintenance notes

- If a new base entity is added to `json_schema.yaml`, the permission `seed_count` automatically
  increases (re-run `npm run generate-code`).
- If `grantAllPermissions` is changed to create additional roles, update `seed_count = 1` for
  the `role` case in `api_spec_context()`.
- If `seedTestDatabase` is changed to create multiple users, update `seed_count = 1` for the
  `user` case accordingly.

## Non-API e2e Test Seed/Grant Adjustments

### Problem: desktop DataGrid virtual-scroll limitation

The desktop Cypress specs use `getDataGridRowCount()` which counts rendered DOM rows
(`div[role="row"][data-rowindex]`). With a fixed-height 500px DataGrid container and MUI's
default row height (~52px), only ~11 rows are rendered in the DOM at once. For `permission`
(seed_count=9), test 1.3 expects 12 rows (9 + 3 populated) but the DOM shows only 11.

**Solution**: Test 1.3 uses `getDataGridTotalRowCount()` (new helper in `datagrid-helpers.ts`)
which reads MUI DataGrid's `aria-rowcount` attribute. MUI DataGrid sets
`aria-rowcount = 1 (header) + total_data_rows` regardless of virtual-scroll state, so
`getDataGridTotalRowCount()` correctly returns the full dataset size.

### Problem: mobile test 4.2 FK constraint violation for user entity

In the mobile CardList spec, test 4.2 selects 2 checkboxes by index and deletes them.
With `seed_count=1` for `user`, the seed test user appears in the card list. Because the
seed user is the `creator_id` of all populated users and has a RESTRICT FK constraint,
deleting it fails and crashes the page (all checkboxes disappear).

**Solution**: When `seed_count > 0`, test 4.2 uses the `cy.task` return value to identify
the two populated records by name (e.g., `records[0].name = 'User 1'`) and selects them
explicitly via `aria-label="Select User 1"`. This avoids selecting the seed user entirely.

### Gate expansion: API + non-API e2e tests run together

`update-generator` and `update-code` tasks now require both:
- `npm run test:e2e:cy:api` — API-layer Cypress specs
- `npm run test:e2e:cy:ui` — desktop + mobile Cypress specs (non-API)
- `npm run test:vitest` — Vitest component/unit tests (excludes `test/flows/`)

These are reflected in `AGENTS.md` gate matrix and `package.json` scripts.
