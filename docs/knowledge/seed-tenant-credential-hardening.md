# seed-tenant.ts Credential Hardening (cmd_504)

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
