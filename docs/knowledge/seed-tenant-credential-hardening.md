# seed-tenant.ts Credential Hardening

## Problem

`scripts/seed-tenant.ts` (`npm run db:seed-tenant`) is a required step of
every provisioning path — `vercel-build`, `build:full`, and GCP's
`scripts/gcp-seed.sh` (via the `app-migrate` Cloud Run Job) all run it. Before
this change it unconditionally created:

- an admin user `admin@example.com` / password `password123`
- a fixed `api_key` literal (`mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1`)

`app-generator` is a **public repo**, so both values are visible to anyone.
Any deployment provisioned without a separate step to rotate them ships with
a publicly known admin login and API key.

The upsert always uses `update: {}`, so re-running `db:seed-tenant` against
an existing database never overwrites a password/api_key that was already
rotated by hand — the risk is entirely in the *first* provisioning run.

## Fix: env-gated credentials, fail-fast, random api_key

`scripts/seed-tenant-credentials.ts` resolves the admin email/password/
api_key. The branch is `NODE_ENV`, not a separate opt-in flag — see the
docstring on `requiresExplicitCredentials()` for why every
production-equivalent entry point already sets `NODE_ENV=production` and
every test/dev entry point does not, so no call site needed to change:

- **`NODE_ENV=production`**: `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`
  are mandatory. Missing or empty → the script throws before touching the
  database (fail-fast; it never falls back to the known defaults).
  `api_key` is always a fresh `crypto.randomBytes(32)` value, printed once
  to stdout after the upsert completes (never written to a log file or
  collector) so the operator can capture it. Because `update: {}` means a
  re-run against an already-seeded database doesn't change the stored
  api_key, the script prints whatever the post-upsert row actually holds —
  never a value it merely *intended* to write.
- **Anything else** (`test`, `development`, unset): unchanged —
  `admin@example.com` / `password123` / the fixed `api_key` literal, exactly
  as before. Cypress specs (`cypress/e2e/auth.cy.ts`,
  `cypress/support/mfa-helpers.ts`) and `test/flows/dev-full.test.ts` are
  pinned to the email/password; breaking this default would fail the
  mandatory `test:e2e:cy:api`/`cy:ui` gates. `TEST_API_KEY` in
  `cypress/support/test-credentials.ts` is a separate, unrelated constant —
  nothing in the repo depends on the specific fixed `api_key` value, only on
  email/password staying constant.

The credential-resolution logic lives in a hand-written module with no
import of the generated Prisma client (or anything else
`code_generator/generate.py` emits), so `scripts/seed-tenant-credentials.
test.ts` runs unit-tested with vitest in a checkout that has never run
`npm run generate-code` — same DI rationale as `lib/approval_request/
actions_core.ts` (see `docs/knowledge/troubleshooting.md` §2.4).

### Required env vars for production-equivalent provisioning

| Var | Required when | Notes |
|---|---|---|
| `SEED_ADMIN_EMAIL` | `NODE_ENV=production` | Any valid email; becomes the bootstrap admin's login. |
| `SEED_ADMIN_PASSWORD` | `NODE_ENV=production` | Plain text in the env var; hashed with bcrypt before storage, never persisted in plaintext or logged. |

Provisioning scripts (Vercel's `vercel-build`, `scripts/build:full`, GCP's
`gcp-seed.sh`/`app-migrate` Job) must have these two vars available in the
environment they run in — set them the same way other provisioning secrets
(`DATABASE_URL`, `AUTH_SECRET`) are set for that target. `api_key` is never
supplied by the operator; it is always generated.

### Wiring per provisioning target

- **GCP** (`scripts/gcp-setup.sh` / `gcp-deploy.sh` / `gcp-seed.sh`):
  `scripts/gcp-env.sh` now requires `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
  in `.env.production.local` (same `:?`-required pattern as
  `UPSTASH_EMAIL`/`UPSTASH_API_KEY` — an operator-chosen value, not a
  generated secret). `gcp-setup.sh` Step 5 registers them as the
  `app-seed-admin-email`/`app-seed-admin-password` Secret Manager secrets;
  `gcp-deploy.sh`'s `app-migrate` Job (Step 2) attaches both alongside
  `DATABASE_URL` so they're present in the container `scripts/gcp-seed.sh`
  later repoints at `npm run db:seed-tenant`. `NODE_ENV=production` is
  already baked into that image via `ENV NODE_ENV=production` in the
  Dockerfile (both `builder` and `runner` stages), so no separate env-var
  wiring was needed for the `NODE_ENV` gate itself — only for the two new
  required vars. Verified: sourcing the updated `gcp-env.sh` with
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` unset fails fast with the
  expected message; setting both succeeds (see this task's report for the
  exact commands and output).
- **Vercel** (`vercel-build`): there is **no dedicated `vercel-setup.sh`
  script in this repo** — Vercel's build pipeline runs `npm run
  vercel-build` directly per `vercel.json`'s `buildCommand`, with
  `NODE_ENV=production` set automatically by Vercel's build environment (for
  both Production and Preview deployments). Set `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_PASSWORD` as Vercel Environment Variables (Project Settings →
  Environment Variables) the same way `AUTH_SECRET`/`DATABASE_URL` already
  are for that project — no script change is needed or possible on the
  Vercel side.

## Remediation runbook: a deployment already seeded with the default credentials

If a production database was already provisioned before this change (or a
future operator sets `NODE_ENV` incorrectly and this guard is somehow
bypassed) and contains `admin@example.com` / `password123` /
`mk_78d1e51a...`, treat it as a compromised credential and remediate
immediately:

1. **Rotate the admin password.** Sign in as `admin@example.com` /
   `password123` and change the password from the account settings page, or
   update it directly:
   ```sql
   -- Generate a bcrypt hash for the new password out-of-band (10 rounds,
   -- matching scripts/seed-tenant.ts), then:
   UPDATE "user" SET password = '<new-bcrypt-hash>' WHERE email = 'admin@example.com';
   ```
2. **Rotate the api_key.** Any client holding the known
   `mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1`
   value can authenticate via the `X-Api-Key` REST path
   (`lib/api-auth.ts`) without a password. Generate a new value and replace
   it:
   ```sql
   UPDATE "user" SET api_key = 'mk_' || encode(gen_random_bytes(32), 'hex')
   WHERE email = 'admin@example.com';
   ```
   (requires the `pgcrypto` extension for `gen_random_bytes`; alternatively
   generate the value application-side and `UPDATE` with a literal.)
3. **Prefer creating a fresh admin and disabling the default one** over just
   rotating in place — this also removes `admin@example.com` as a
   guessable, publicly-known login name, and matches the operational
   practice this hardening makes mandatory rather than optional:
   - Sign in with the rotated credentials from step 1.
   - Create a new user, assign the `Administrator` role (Permissions page).
   - Sign in as the new admin, then either delete the `admin@example.com`
     user or clear its `password`/`api_key` columns (`NULL`) to disable
     credential-based sign-in for that account without breaking any
     `creator_id`/`updater_id`/`actor_user_id` foreign keys still pointing
     at it.
4. **Audit for use.** Check `audit_log` (if enabled for this deployment) and
   any external access logs for activity under `admin@example.com` or the
   known `api_key` prior to rotation, to rule out that it was actually used
   by an unauthorized party.

Steps 1–2 are the minimum; step 3 is the safer end-state for any deployment
that wants to remove the well-known `admin@example.com` login name entirely,
not just its credentials.

## Fixed permission enumeration

`scripts/seed-tenant.ts` grants the `Administrator` role full CRUD on a
**fixed list** of 8 entities plus read-only `audit_log` — see
`docs/knowledge/authorization-default-deny.md` §"seed-tenant.ts Role" for
the exact list and the "Adding Tests for a New Entity" section explaining
why consumer/project-specific entities must never be added to this shared
generator-owned script.

This is a deliberate design boundary, not a bug: any entity a consuming
project adds on top of the default schema (e.g. `purchase_order`, `shift`)
is **never** included in this enumeration, so the seeded Administrator role
starts with **zero** permissions on it. This hardening task does not change
that scope — extending the enumeration to be schema-derived instead of
fixed is a separate, unscoped decision. In practice this means:

- After provisioning a consumer deployment, the bootstrap admin can sign in
  and manage the entities in the fixed list (users, roles, organizations,
  permissions, settings, approval requests/flows, dashboards) immediately.
- For every other, consumer-added entity, the admin must explicitly grant
  the `Administrator` role — or any other role — permissions via the
  Permissions UI before anyone (including the admin) can use it, even
  though the admin already holds every other permission.
- This is intentional least-privilege-by-default behavior, not a
  provisioning failure. Document it for the deployment's own operators if
  it's likely to surprise them.

## Development use: the `grant-all-permissions` script

> **Not part of the standard setup.** `scripts/grant-all-permissions.ts` is a
> development / verification tool. Do not run it in production without
> deliberate opt-in.

The section above is unchanged and remains correct: `seed-tenant.ts` keeps
its fixed, least-privilege enumeration. Separately, `code-generator` now
derives the full "independent entity" population of the project schema (the
same criteria `cypress/support/db-helpers.ts`'s deletion-order helper uses,
adapted for permission-grant purposes) into `scripts/generated/seed-entities.ts`
at `generate-code` time — this automatically includes any entity a consuming
project adds on top of the default schema, with no manual update required.

`scripts/grant-all-permissions.ts` consumes that generated list to grant the
`Administrator` role full CRUD on every independent entity in one step —
useful after adding a new entity, to exercise it end-to-end without manually
opening the Permissions UI first.

Not to be confused with `grantAllEntityPermissions()` / `cy.task('db:grant
AllPermissions')` (`cypress/support/db-helpers.ts` —
`docs/knowledge/authorization-default-deny.md` §"Test 3-Category
Classification"): that one operates only inside a Cypress test run, against
the Cypress **test user** (not `Administrator`), over `ALL_ENTITIES` (the
test-spec entity population — see `db_helpers_context()`). This script is a
standalone CLI for a real `Administrator` role, over the independent-entity
population (`SEED_ENTITIES`) described above. Similar name, different
mechanism, different population, different actor.

| Script | Purpose | When to run |
|---|---|---|
| `seed-tenant.ts` | Minimum privilege for production use | Every `npm run db:seed-tenant` |
| `scripts/grant-all-permissions.ts` | Full permission for development / verification | Manually, `npm run db:grant-all-permissions` |

Safeguards:

- **`DRY_RUN=true`**: prints what would be changed without writing.
- **Production guard**: refused unless `--force` is passed when
  `NODE_ENV=production`.
- **`audit_log` / `mfa_recovery_code` excluded**: never granted write
  access; `audit_log` stays read-only regardless (its permission row is
  managed by `seed-tenant.ts`'s own dedicated upsert, untouched by this
  script). This exclusion is layered: the generated entity list already
  structurally excludes both (neither is a schema-defined entity — see
  `seed_entities_context()` in `code_generator/generators.py`), and this
  script re-asserts it explicitly (`ALWAYS_EXCLUDED`) rather than relying
  on the upstream guarantee alone.

If the minimum-privilege boundary changes in a future release,
`grantAllPermissions()` is exported (not just a CLI) so it could be wired
into `seed-tenant.ts` with a single import + call — that integration is
not made today.

## `Creator` / `Assignee` roles

`seed-tenant.ts` also seeds two special, item-scoped roles resolved by name
in `lib/authz.ts` (`SPECIAL_ROLE_NAMES`). Neither requires an explicit
per-user role *connection* — every user implicitly qualifies for whichever
applies to a given row (`creator_id === userId` / `assignee_id === userId`),
evaluated per item by `resolvePermissions()`.

- **`Creator`**: granted exactly `setting.read` + `setting.update` and
  nothing else. This is the mechanism by which a non-admin user reaches
  their own `/setting` page — without it, `getModelPermissions()` denies
  everyone but an Administrator when no permission row exists at all (see
  its `rows.length === 0` branch). Deliberately not extended to any other
  entity: a broader "owners can manage their own records" grant is a
  separate decision this seed does not make.
- **`Assignee`**: seeded with no permissions at all — a placeholder role
  for future use, matching the vocabulary `getters.ts.jinja2` already uses
  without granting anything today.

## `user.creator_id` self-reference exception

Every generated `add<Entity>()` service function sets `creator_id: actorId`
(the acting user) unconditionally — this is correct for every entity except
`user` itself. `setting` is a proxy view of a user's own row (`allOf: user`), and
its `x-self-only` access check filters by `creator_id === the logged-in
user's id`. If a newly created user's `creator_id` were left as the actor
who created them (e.g. an Administrator provisioning a new account), that
user could never reach their own `/setting` page — their row's `creator_id`
would point at the admin, not at themselves.

`user.x-generate.new` is `false` by default, so this code path is not
normally reachable — no default create form/route exists for `user`, and
this is not expected to change in the default schema. If a consumer project
ever sets it to `true`, add a hand-written `lib/user/service_after_create.ts`
(the standard write-once customization point, not a generator template
change — `x-generate.new: true` is a per-project schema edit, and this fix
is specific to the one entity a project chooses to expose it on):

```ts
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function afterCreate(
  tx: unknown,
  created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {
  const db = tx as Tx;
  const id = created.id as string;
  await db.user.update({ where: { id }, data: { creator_id: id } });
}
```

Verified against a live database: with this hook, a user created by an
Administrator ends up with `creator_id === id` and can read/update their own
`/setting` row; without it, `getModelPermissions('setting', ...)` and the
`x-self-only` `creator_id` filter both correctly deny access to the row —
reproducing the exact failure this hook exists to prevent. A hand-written
hook was tried first and found sufficient; no generator/schema flag (e.g. a
prospective `x-self-creator-id`) was needed.
