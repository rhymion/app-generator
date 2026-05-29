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

## seed-tenant.ts Role

`scripts/seed-tenant.ts` seeds an `Administrator` role with full CRUD on all 16 entities:

```
user, role, organization, permission, setting,
approval_request, approval_flow, approvable, comment, commentable,
dashboard, dashboard_widget, attachment, attachable, audit_log, tenant
```

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

When adding a new entity to the schema:

1. Add the entity name to `ALL_ENTITIES` in `cypress/support/db-helpers.ts`.
2. Also add it to `scripts/seed-tenant.ts` entities array.
3. For new Cypress normal-flow tests: use `cy.task('db:grantAllPermissions')` in `beforeEach`.
4. For API-level no-permission tests: add cases to `lib/authz.test.ts`.

## Existing Test Refactoring Guide

If a test was written before the default-deny change and now fails with access denied:

1. Determine if it is a normal-flow test (Category 1).
2. Add `cy.task('db:grantAllPermissions')` after `cy.task('db:seed')` in `beforeEach`.
3. For Vitest integration tests hitting a real DB: call `grantAllEntityPermissions()` from
   `cypress/support/db-helpers.ts` (or create an equivalent helper in `test/helpers/`).
