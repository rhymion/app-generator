# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [Unreleased]

## [4.1.0] - 2026-09-19
### Fixed
- **`docker compose up` silently accepted a named Postgres volume left over
  from before the PostgreSQL 16→18 upgrade (issue #610), which then made
  every downstream step fail with an unrelated-looking "Can't reach
  database server"** (issue #643) — postgres:18's entrypoint
  (docker-library/postgres#1259) refuses to start against a volume whose
  root still holds a flat, pre-18 cluster, but `up -d` returns as soon as
  the container is created, not once postgres is actually accepting
  connections, so the failure was invisible until `db:push`/seed/Cypress
  hit it several steps later. `scripts/docker-compose-env.js` now runs a
  read-only pre-check before any `up` command: if a postgres service's
  resolved named volume already exists and its root holds a `PG_VERSION`
  file that doesn't match the image's major version, it refuses to run
  `docker compose` at all and names the volume plus the fix (discard and
  recreate it). A volume that doesn't exist yet, or is already correctly
  laid out, passes through unchanged.

- **`resetTestDatabase()` did not delete `app_setting` rows before `user`,
  breaking every API Cypress spec's `before each` hook** (issue #614) — the
  generated deletion order (`db_helpers_context()` in
  `code_generator/generators_test.py`) was derived purely from
  `json_schema.yaml`-declared entities, so a hand-written base Prisma model
  with no `json_schema.yaml` entry (`app_setting`, added by the
  business-date-container feature) was invisible to it. Once
  `scripts/seed-baseline.ts` started writing a real `app_setting` row, any
  consumer with at least one `user` hit `app_setting_creator_id_fkey` on
  the very first test reset, 100% of the time. Generalized the previous
  two-name hardcoded exception list (`audit_log`, `mfa_recovery_code`) into
  auto-detection: any hand-written model referencing `user` or a
  schema-declared entity, with no inbound reference of its own, is now
  scheduled for cleanup automatically — no per-model code change needed for
  `app_setting` or any future addition of the same shape.

- **Generated old-form 14.4 resubmit-after-withdraw API test always failed
  with 400 for an `x-approval` entity with a non-terminal `on_rejected` but
  no `on_withdrawn` declared** (issue #607) — a later server-side rule
  rejects any withdrawal for such an entity outright, but the generated
  test still unconditionally asserted the withdraw call itself succeeded
  with 200. `test_api_spec.cy.ts.jinja2`'s old-form 14.4 branch is now
  gated on `has_on_withdrawn`; when absent, a separate variant is generated
  instead, asserting the withdraw call is rejected with 400 and the
  approval_request is left untouched (mirroring the existing 14.2M/14.3M
  multistage withdraw-lockout pattern).

- **Post-approval edit/delete lockdown's generic fixture had no escape
  hatch when the schema's own default for the lockdown field was itself a
  frozen value** (issue #608) — for an entity with a terminal `on_rejected`,
  no `on_withdrawn`, and a default equal to `submit_on`'s own target value,
  the 3-tier fallback in `generators_test.py`'s lockdown-override
  computation gave up entirely, leaving the generic `populate{Pascal}Data()`
  fixture at the raw (locked) DB default — which 403'd every generic CRUD
  test built on it (4.1/4.2/9.1/9.2/10.1/10.2), even though none of them
  exercise approval flow. Added a 4th fallback tier: scan the field's own
  enum for a value outside the frozen-values set.

- **Generated `service.ts` failed to build (`TS2304: Cannot find name`) for an
  `x-approval-lines` / `x-reservation` (`ledger_transaction`) lines entity that
  also declares its own `x-generate` (list/view pages, e.g. for a per-line
  approve/reject UI) with no write path of its own (`new`/`edit`/`api: false`)**
  — such an entity was misclassified as independent (its own `x-generate`
  existing was read as "has a write path elsewhere"), which silently dropped
  its nested-create from the parent's `add`/`update` function while the
  approval-lines pre-create code still referenced the now-undeclared array
  parameter (issue #604). See `code_generator/build_context.py`'s
  `_build_child_data`.

- **`is_independent`'s root computation treated ANY `x-generate` block —
  even a list/view-only one — as proof a child manages its own
  create/edit/delete, wrongly hiding the parent form's "Add"/edit/delete
  controls for a child that cannot actually write itself** (e.g.
  `receiving_receipt_line`, whose `x-generate` sets `new`/`edit`/`delete`
  all `False`). The line for whether a parent may still add/edit/delete a
  child is whether the CHILD can write itself, not whether it merely has a
  page. `build_context.py`'s `_build_child_data` now computes
  `is_independent` from `new`/`edit`/`delete` (see the new
  `helpers.schema_helpers.child_has_own_write_capability`), not bare
  `x-generate` presence; the `nested_writable` flag from the #604 fix above
  is unchanged. Also corrected the two other places that mirrored the old
  (wrong) computation: `generate.py`'s `_entity_is_write_reachable` (the
  equivalent check for `x-approval`'s write-reachability axis) and
  `generators_test.py`'s `get_child_render_type` (the generated test
  suite's own expected-render-type mirror). Issue #609, which had reported
  this same child's "Add" control reappearing as a regression, was itself
  filed on the wrong premise — that reappearance was the correct behavior
  its schema calls for, once measured against the actual generated code
  rather than the (also incorrect) `receiving_receipt.lines`-has-its-own-
  new/edit-pages assumption its reproduction steps carried.

## [4.0.0] - 2026-09-17
### Security
- **Closed a bypass letting an ordinary user set an `x-approval` field to a value reserved for
  `on_approved`/`on_rejected` `set_fields`**, directly via the form, REST API, or CSV import —
  skipping the approval step entirely. Both the shared validator and the CSV import route now
  reject such a value (a no-op resubmit of the record's own current value is still allowed).
  Coverage depends on which of `on_approved`/`on_rejected` an entity declares `set_fields` for.
  See `docs/knowledge/x-write-locked-values-field-lockdown.md`.

- **CREATE had no read-only field enforcement**: unlike PUT's existing check, a client-submitted
  value for an `x-readonly`/`x-readonly-fields` field flowed straight into the database on create,
  via both the REST route and the server action. Both entry points now reject any client-submitted
  value for such a field on create (`x-server-value` fields are exempted — see Added). See
  `docs/knowledge/x-server-value-actor-delegation.md`.

- **Server Action approval endpoints could bypass multi-stage `preceded_by` ordering** — only the
  REST route enforced it via `assertApprovalOrder()`; the Server Action reachable from any
  authenticated client did not (a later-stage approval could succeed while an earlier stage was
  still pending). Both entry points now call the same check. See
  `docs/knowledge/appendix/approval-flow.md` §16.6.1.

- **MFA could be bypassed via Google OAuth sign-in**: `mfa_enabled` was only checked in the
  credentials sign-in path, so an SSO-provisioned user with MFA enabled reached a fully
  authenticated session via Google without a TOTP/recovery-code prompt. The `jwt()` callback now
  blocks every protected route behind a new `/mfa-challenge` page until MFA clears; a new
  `user.mfa_token_version` column also revokes an already-active session when MFA is enabled. See
  `docs/knowledge/authentication.md` "MFA on the OAuth path".

### Added
- **An independent child (own `x-generate`) may now be embedded in a parent's view with any
  non-`list`, non-`comments` `x-outputType`, even when its own `x-generate` disallows
  new/edit/delete** (issue #520). The parent-embedded display stays read-only regardless.
  `x-outputType: comments` keeps its prior restriction. See
  `docs/knowledge/schema-yaml-configuration.md` §7.4.
- **New entity-level schema key `x-write-locked-values` declares field values that only the
  system may write, independent of `x-approval`.** Composes (union) with `x-approval`'s locked
  values — existing `x-approval` entities are unaffected. **Defaults to *unlocked* on a proxy
  view** (opt back in by declaring the key on the view itself). **Renamed**:
  `derive_approval_locked_values()` → `derive_write_locked_values()`;
  `APPROVAL_LOCKED_FIELDS`/`ApprovalLockedField` → `WRITE_LOCKED_FIELDS`/`WriteLockedField` in
  `service_validation.ts` and the CSV import route (its `APPROVAL_LOCKED_VALUE` error code string
  is unchanged). See `docs/knowledge/x-write-locked-values-field-lockdown.md`.
- **Post-decision row freeze now also applies to a *terminal* rejection, not just approval.**
  **Behavior change**: an entity declaring `on_rejected.terminal: true` now rejects
  edit/delete/invalidate (`403 *_forbidden:approval_locked`) on a row at that terminal value,
  where it previously allowed it. A non-terminal rejection or withdrawal still releases the lock
  as before. See `docs/knowledge/appendix/approval-flow.md` §16.15/§16.18.
- **New pre-generation check (`validate_submit_on_default_matches_prisma()`) flags a
  value-level mismatch between an `x-approval.submit_on` field's JSON `default:` and its Prisma
  `@default(...)`** — the existing cross-schema check only checked *presence*, not value
  agreement. Scoped to `submit_on` fields only. See
  `docs/knowledge/appendix/approval-flow.md` §16.19.
- **Opt-in `binField` on `x-ledger-entities.<domain>`**, a fifth pool-entity column alongside
  the existing required `itemField`/`locationField`/`lotField`/`expirationField` (all still
  required; this key alone is optional). Omitting it is a no-op (byte-identical output). See
  `docs/knowledge/appendix/inventory-reservation-split.md` §7.3.
- **Eight in-tx write hooks now exist**: `afterCreate`, `afterUpdate`, `afterDelete`,
  `validateOnDelete`, `afterSubmit`, `beforeApprove`, `beforeReject`, `beforeWithdraw` — every
  `can_create` entity gets a no-op-by-default stub for each, called inside the write's own
  transaction (a throw rolls back everything). **Behavior change**: a non-audited entity's
  `delete{Entity}` is now wrapped in its own transaction for the first time (previously several
  independent, non-rollback-linked calls). See `docs/knowledge/post-create-side-effect-hook.md`.
- **`validateCustomRules()` now also receives the pre-edit row and the acting user's id
  (`actorId`) as a 5th parameter** — lets a hand-written rule reject a save based on what a
  field WAS, or stamp a system-owned row with the actor. Existing hand-written
  `service_validation_custom.ts` files need no edit. See
  `docs/knowledge/pre-edit-row-handoff-to-custom-validation.md` and
  `docs/knowledge/actor-id-handoff-to-custom-validation.md`.
- **README.md/README_ja.md sync gate** (`npm run check:readme-sync`) — fails closed if a
  branch's diff touches one file without the other. Added as a Completion gate step in
  `add-component.md`, `generate-schema.md`, `update-code.md`, `update-generator.md`. See
  `docs/knowledge/readme-en-ja-sync-gate.md`.
- **`x-filter-values`: view-scoped row restriction, enforced server-side on read and write.** A
  view entity can declare `x-filter-values: { field: [values], ... }` to restrict which rows it
  shows and can write to. A write to a row already outside the view is rejected (`404`).
  Composes with org isolation and `x-self-only` via AND. See
  `docs/knowledge/filter-values-row-scope.md` and `.claude/commands/generate-schema.md`'s
  "x-filter-values" section.
- **Withdraw lockout for entities that never declare `x-approval.on_withdrawn`**, plus a new
  structural validation (`_validate_x_approval_combinations()`) enforcing a truth table over
  `submit_on`/`on_withdrawn`/terminal-`on_rejected`/editability. Withdrawal is blocked at the
  API (`400`) and Server Action layers for entities lacking `on_withdrawn`, and the Withdraw
  button is hidden for them. **Breaking for schema authors**: an invalid combination now raises
  a generation-time `ValueError` naming the entity and failed condition. See
  `docs/knowledge/appendix/approval-flow.md` §16.16.

- **`x-relationship: { target: attachment, type: direct }`** — new single-file FK field
  declaration (a profile picture, a signed contract), rendered via `SingleAttachmentUpload`/
  `SingleAttachmentDisplay`. Unlike the existing `attachable_id` bridge, this `attachment` has
  no list/view/new/edit pages of its own. `attachment.attachable_id` is now nullable to allow
  this. See `docs/knowledge/schema-yaml-configuration.md` (Direct Attachment FK).
- **`x-uri-kind: file`** — a third `format: uri` field kind alongside `image`/`link`: uploads
  via `/api/upload` like `image`, but displays as a download link/icon instead of an `<img>`.
  Shares components with the direct-attachment FK above. See
  `docs/knowledge/schema-yaml-configuration.md`.
- **`NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_COPYRIGHT`** — optional env vars overriding the
  app title and footer copyright text without a code change. Inlined at build time (a Vercel
  rebuild, not just an env var edit, is needed to pick up a change). See
  `docs/knowledge/noindex-default-and-branding-env-vars.md`.
- **`x-scheduled-tasks`** (top-level, plural) — a bulk, entity-agnostic sibling of
  `x-scheduled-task`, for operations spanning many entities or an entire table with no row
  filter. Shares the task registry and `vercel.json` `crons` array with the entity-level form.
  See "Bulk mode" in `docs/knowledge/scheduled-task-operations.md`.
- **Docs-only changes now skip the Vercel build** for the three consumer projects, via
  `scripts/vercel-ignore-check.sh` + a root-level `vercel.json` stub (`ignoreCommand`) in each
  consumer repo — a Root-Directory-scoped `ignoreCommand` inside this repo's own `vercel.json` is
  never read by Vercel, confirmed empirically. See `docs/knowledge/vercel-docs-only-ignore-command.md`.
- **New `verify-canonical-ci` job in the canonical consumer `.github/workflows/ci.yml`** checks
  out the consumer's `app-generator` submodule and fails if its own body differs from the
  submodule's distributed `docs/consumer-commands/ci.yml` copy — closes the gap where a
  distributed copy silently drifted from canonical (a step's `name:` and several comments had
  already diverged). See `docs/knowledge/ci-workflow-canonical-source.md`.
- **New opt-in Stripe payment integration, gated by a new `x-payment` entity-level schema key.**
  Declaring `x-payment: true` writes three write-once stub files on first `generate-code`:
  `lib/stripe.ts`, `app/api/payment/checkout/route.ts`, and `app/api/webhooks/stripe/route.ts`
  (signature-verified). Scope is one-time purchases only; `.env.example` gains the three Stripe
  env var placeholders. See `docs/knowledge/stripe-payment-integration.md`.
- **`scripts/vercel-{setup,deploy,env,teardown}.sh` and `.env.vercel.production.local.example`
  promoted to a single canonical source**, replacing independently-drifting copies across
  app-template/inventory-app/insurance-app — also fixes a real gap found in the process
  (app-template's copy was missing `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`). See
  `docs/knowledge/vercel-deploy-scripts-canonical-source.md`.
- **New Prisma `Decimal` support in the code generator, mapped to JSON schema type `"string"`
  (never `"number"`)** to avoid silent float-rounding error on read/write/CSV round-trip —
  previously unsupported (`schema_deriver.py` raised `SchemaDivergenceError`). Spans schema
  derivation, form/CSV validation, the numeric-styled form input, and a new `test:decimal-gate`
  fixture (this repo's own schema has no Decimal field, so nothing would otherwise compile these
  branches). See `docs/knowledge/decimal-field-generator-support.md`.
- **New dev/verification-only script `scripts/grant-all-permissions.ts`**
  (`npm run db:grant-all-permissions`) grants the `Administrator` role full CRUD on every
  independent entity in one step, including any entity a consumer project adds. `audit_log`/
  `mfa_recovery_code` stay excluded. `scripts/seed-baseline.ts` (the production seed) is unchanged.
  See `docs/knowledge/seed-baseline-credential-hardening.md`.
- **New opt-in Neon serverless driver adapter for `lib/prisma.ts`, gated by `USE_NEON_ADAPTER`.**
  `scripts/vercel-env.sh` now injects it as `"true"` on every consumer app provisioned via
  `vercel-setup.sh`; unset or any other value falls through to the existing `PrismaPg` path
  unchanged. GCP Cloud Run and local/CI are unaffected. See
  `docs/knowledge/architecture-overview.md`.
- **New `npm run lint:prj` script (`scripts/lint_prj_synced.py`)** lints only a consumer's own
  `prj/`-tracked `.ts`/`.tsx` files at their real synced destination paths, without linting this
  repo's templates or the consumer's fully generated codebase. Fails closed (non-zero exit) if
  nothing was measured. See `docs/knowledge/consumer-prj-scoped-lint.md`.

- **CSV export/import and approve/reject now accept `X-API-Key` as well as a browser session**
  — these five routes previously resolved the caller only via a session, so an external
  API-key client could never call them. Added `resolveActorId()`/`requireDualAuth()` to
  `lib/api-auth.ts` (same dual-auth pattern as `app/api/search/route.ts`). See
  `docs/knowledge/testing-cypress.md`.
- **New API-only regression test**: `test_api_spec.cy.ts.jinja2` gains "4.5 returns 200 for GET
  when the acting user cannot read `<fk target>`", alongside the pre-existing 4.4. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.

- **`x-server-value` now supports actor delegation**: `x-server-value: {source: actor,
  override_permission: <Operation>}` lets an actor holding that permission supply an explicit
  value on create instead of always defaulting to their own id (e.g. filing on someone else's
  behalf). The REST create response gains an optional `_server_value_overrides` flag when this
  happens. The plain string form `x-server-value: "actor"` is unchanged. See
  `docs/knowledge/x-server-value-actor-delegation.md`.

- **New `check:generated` gate rule, `test:unexplained-login`**: scans every generated
  `cypress/e2e/api/<entity>.cy.ts` for a `cy.login(` call with no `dual-auth-session-canary`
  marker comment above it, so a future template edit that reintroduces screen-operation coupling
  fails the gate instead of silently landing. See `docs/knowledge/testing-cypress.md`'s "API test
  / UI test boundary" section.
- **FK autocomplete search now derives from `labelField`; `x-relationship.searchField` is
  removed.** The two used to be independent declarations that could silently drift apart.
  **Breaking for schema authors**: `validate.py` now rejects any schema still declaring
  `searchField`. See `docs/knowledge/schema-yaml-configuration.md` §5.
- **CSV import now supports composite/dotted `labelField` FK columns** (previously export-only)
  — a CSV cell is matched against the full rendered label text. An ambiguous match is rejected
  at row granularity (`MULTI_MATCH`). See `docs/knowledge/csv-import-composite-labelfield.md`.
- **`x-self-only`: new entity-level flag for permission-independent, per-creator data
  isolation (Stage 1).** No permission grant (including `general.read`) can widen it; a
  non-owner's row reads as `404 Not Found`. `x-self-only: { admin_bypass: true }` allows
  privileged read, with a mandatory (fail-closed) audit write. The account **Settings** page now
  uses this (other users' settings are no longer reachable via any permission grant). Row-Level
  Security (Stage 2) is not implemented. See `docs/knowledge/self-only-entity.md`.
- **Post-login redirect-back with open-redirect protection** — signing in now returns to the
  originally-requested page (`?redirect=`) instead of always landing on `/`.
  `safeRedirectPath()` rejects off-site/protocol-relative/backslash-trick values, falling back
  to `/`. See `docs/knowledge/unauthenticated-page-redirect.md`.
- **`@mention` support, server and client.** New `MentionInput`/`MentionText` components and a
  `searchMentionUserOptions()` server action; wires into any entity's `x-mention: true` field
  and comment threads. Fires a new `'mentioned_in_comment'` notification. See
  `docs/knowledge/mention-system.md`.
- **Generated permission-denial and cross-org isolation API tests (batch A)**: every generated
  `cypress/e2e/api/<entity>.cy.ts` now includes PUT/DELETE/export/import permission-denial
  tests and, for org-scoped entities, cross-organization isolation tests. Adds the
  `db:createCrossOrgScenario` test-fixture task. See `docs/knowledge/permission-e2e-test-design.md`.
- **Graceful degradation for foreign-key read-permission gaps** — a role that can create/edit
  an entity but lacks read on one of its FK targets used to crash the create/edit page entirely;
  the affected field now renders disabled instead (read-only + blocks `/new` if required,
  clearable if optional). No Prisma/migration change. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.
- **Terms of Service / Privacy Policy pages** (`/[locale]/legal/terms`,
  `/[locale]/legal/privacy`), linked from registration. Per-locale plain Markdown under
  `content/legal/`; both are explicitly labeled templates requiring legal review before real
  use. See `docs/knowledge/legal-documents.md`.
- **New `app_setting` model** — a per-organization business-date override, container only for
  now: no read function, admin UI, scheduled-task wiring, or audit-log extension exists yet,
  only the model itself (`organization_id`, `business_date`, `is_pinned`, `timezone`). See
  `docs/knowledge/appendix/business-date-container.md`.
- **New `user.email_notifications_enabled` column** — an opt-in master switch for email
  notifications, container only for now: no sending mechanism exists yet. Defaults to `false`;
  an unrelated user must actively opt in, never be opted in by default.

### Changed
- **Approval-request creation moves off the write-once `afterCreate` hook into an
  edge-trigger emitted directly in the generated `add{Parent}`/`update{Parent}`** — fires on
  the transition into `x-approval.submit_on`'s target value, at create or update. **Behavior
  change**: `resubmitApprovalRequest` (its own server action, REST route, and UI button) is
  removed — re-submission after a non-terminal rejection is now an ordinary edit of the
  entity's own status field back to `submit_on`'s value. See
  `docs/knowledge/appendix/approval-flow.md` §16.4/§16.6.
- **`user.image` moved from a plain URL string to a direct-attachment FK** — the profile
  picture is now an uploaded file tracked as an `attachment` row. **Breaking**: OAuth sign-in
  no longer copies the provider's profile-image URL into `user.image`; a user's avatar now
  comes only from their own upload. Prisma: `user.image String?` → `user.image_id String?
  @unique` plus a relation. No data migration (pre-customer). See
  `docs/knowledge/schema-yaml-configuration.md`.

- **`scripts/seed-tenant.ts` renamed to `scripts/seed-baseline.ts`** (`npm run db:seed-tenant`
  → `npm run db:seed-baseline`), with its neighboring credential-hardening files renamed to
  match. No backward-compatible alias is provided. **Consumer impact**: any consumer invoking
  `npm run db:seed-tenant` directly must switch to `db:seed-baseline`. See
  `docs/knowledge/seed-baseline-credential-hardening.md`.
- **Generated apps now default to blocking search-engine indexing** — `app/layout.tsx` sets
  `noindex` unless `lib/site-config.ts`'s `seo.noindex` is explicitly `false`; an app with no
  `seo` block at all is also now noindexed. See
  `docs/knowledge/noindex-default-and-branding-env-vars.md`.
- **`scripts/seed-baseline.ts` now also seeds `Creator` and `Assignee` roles.** `Creator` is
  granted exactly `setting.read`+`setting.update`; `Assignee` is seeded with no permissions
  (placeholder for future use). See `docs/knowledge/seed-baseline-credential-hardening.md`.
- **Removed the dead in-process notification store from `lib/_notifier.ts`** (a no-op read
  path with zero production callers). `notify()`'s write path is unchanged except its return
  type, now `void`. See `docs/knowledge/notification-triggers.md`.

- **Generated API test spec no longer authenticates via `cy.login()` except one deliberate
  canary case** — 15 `cy.login()` call sites were classified and switched to
  `X-API-Key`/`db:createLimitedApiUser` where the route already supports it; one is kept as a
  canary proving the session-cookie half of dual-auth still works. See
  `docs/knowledge/testing-cypress.md`'s "API test / UI test boundary" section and
  `check_generated.py`'s new `test:unexplained-login` gate rule that now enforces it.
- **`fk_read_permission_graceful_degradation.cy.ts` moved from `cypress/e2e/api/` to
  `cypress/e2e/`** — every case in this hand-written spec drives the browser and never issues a
  raw `cy.request`, so it was never actually API-gate coverage despite living under `api/`. It
  now sits under the UI-spec glob instead. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.

### Removed
- **Field-level schema key `x-fk-constrained`** (added in #484) — no consumer schema declared
  it, and the one prior usage had already been made a required column by a different fix,
  retiring the need for the key.

- **Removed `scripts/seed.ts` (`npm run db:seed`)** — unused sample-data script, not
  referenced by any npm script, prisma seed hook, or CI workflow. No replacement.

- **Removed the `x-relationships.<rel>.sameEntityField` schema key** and its generated
  `validateSameEntityRefs()` — a coincidental business rule had been generalized into the
  schema layer. Replaced with a purely structural socket: every entity now gets an
  unconditional write-once `service_validation_custom.ts` stub. See
  `docs/knowledge/same-entity-validation-socket.md`.

### Fixed
- **A missing `regions` key in `vercel.json` is now backfilled** (`['sin1']` default)
  instead of left absent forever; an existing value is never touched. See
  `docs/knowledge/vercel-region-alignment.md`.
- **An unreachable Redis no longer crashes `/api/auth/*`** (Issue #587): the rate
  limiter now fails OPEN on any Redis error instead of throwing, logging the degraded
  window (`[rate-limit:fail_open]`) rather than failing silently. See
  `docs/knowledge/authentication.md`.
- **OAuth+MFA second-factor Server Action had no rate limiting** (Issue #588):
  `completeMfaChallenge` now has its own `auth:mfa:challenge` bucket (10 attempts / 5
  min, keyed by user id), surfacing a `RATE_LIMITED` error on the challenge page. See
  `docs/knowledge/authentication.md`.
- **The generated app could show create/edit affordances (list page's "+" button,
  edit icon, and the `grant-all-permissions.ts` dev script's own grants) for an
  operation `x-generate` actually disables**, 404ing when clicked. Both the dev
  script and the shared list components (`DataGridClient`/`CardListClient`/
  `ResponsiveListClient`) now derive their allow/deny from the entity's real
  `x-generate.new`/`.edit`/`.delete`/`.list`/`.view`/`.import` (a Jinja2 `.update`
  accessor bug that had defeated the dev-script fix for `update` specifically is
  also closed). Delete was already correct and unaffected. See
  `docs/knowledge/grant-all-permissions-x-generate-gate.md`.
- **Composite/dotted `labelField` on an embedded DataGrid child's own FK relation
  rendered blank** (Issue #539): the child's Prisma include now resolves nested
  relations the same way the entity's own independent list page already does. See
  `docs/knowledge/child-datagrid-reference-columns.md`.
- **`format: date`/`time` on an embedded DataGrid child's own field always displayed
  a fixed date+time**, ignoring the field's declared format (Issue #540): now reuses
  the shared `formatLabelValue()` formatter; `date-time` columns are unaffected. See
  `docs/knowledge/child-datagrid-reference-columns.md`.

- **An independent child (its own `x-generate` permits new/edit) embedded in a parent with
  a non-`list` `x-outputType` is now read-only everywhere — the parent's edit form, not just
  its view page** (Issue #520). Fixing this also surfaced and closed three related generator
  defects in the same code paths: a datagrid child's self-referencing FK (e.g. a splittable
  `parentField`) no longer gets pulled in as a spurious extra dependency in generated tests
  (Issue #531); a generated `service.ts`'s `normalizeChildRefs` import and an unused
  `initial{Xxx}s`/`search{Xxx}Options` prop pair on `FormUpsert.tsx` are no longer emitted
  when nothing references them (Issue #532); and a second, previously-masked
  `ReferenceError` in the same generated Cypress test helper (a self-ref FK misclassified as
  an outer-model dependency) is fixed by tagging self-ref dependencies explicitly instead of
  inferring them from name equality. See `docs/knowledge/schema-yaml-configuration.md` §7.4.
- **An embedded DataGrid child's column order now follows its own `x-display.form` declaration
  when present** — order only; which columns are shown is unchanged. See
  `docs/knowledge/readonly-field-form-rendering.md`.
- **The generated submit-for-approval Server Action no longer throws across the `'use server'`
  boundary, and its caller no longer discards the result.** Failures now return the same
  `ActionFailure` shape as ordinary create/update actions (a reservation-capacity rejection
  as a new `CAPACITY` code, anything else as `UNKNOWN`), awaited and displayed inline by
  `ApprovalSection.tsx`. See
  `docs/knowledge/error-message-framework.md`.
- **An optional (nullable) enum field with no `default:` no longer seeds the first enum
  member on the "new" form** — it now stays unset until the user picks a value; fields with
  an explicit `default:` are unaffected. See `docs/knowledge/nullable-enum-default-fix.md`.
- **`sharp`/`baseline-browser-mapping` CVEs resolved** via non-breaking `npm audit fix`
  (GHSA-rgj7-g3m4-5g8c, GHSA-w5vr-8v7q-w6rv) — newly-published advisories, not a regression
  in this repo.
- **~13 more unused-variable lint-gate warning sources root-caused and fixed** across
  generator templates not exercised by this repo's own dogfood schema. See
  `docs/knowledge/cmd607-generator-lint-debt-fix.md`.
- **`.env.example` now documents `IMPORT_MAX_ROWS`/`IMPORT_MAX_BYTES`** (defaults 5000 /
  10MB), the env vars that override CSV import row/byte ceilings.
- **Internal role/honorific vocabulary removed from generator-authored comments** in
  `api_import_route.ts.jinja2` and two source-only files; reworded to English.
- **CSV import now commits through the same `lib/{entity}/service.ts` functions the REST
  route and Server Action use** (for entities without an embedded-DataGrid-child or
  bridge-child-parent shape), instead of bypassing `validateOnAdd`/`validateOnUpdate` and
  every `afterCreate`/`afterUpdate` side effect via a raw `tx.model.create/update`. See
  `docs/knowledge/import-create-missing-bridge-fk-fix.md`.
- **A composite/dotted-label FK's CSV-import lookup now includes org-null candidate rows
  when its target's `organization_id` is optional**, matching the two sibling dotted-FK
  lookup branches — a shared/global reference table with a `NULL` `organization_id`
  previously produced zero candidates and failed every import referencing it. See
  `docs/knowledge/org-optional-entity-support.md`.
- **A nullable plain-text field written as `''` now persists as `NULL`**, the same as an
  omitted value, across CREATE/UPDATE/validation — previously the two forms could silently
  fail to match on a later equality lookup (e.g. inventory bin/lot matching), creating
  duplicate rows instead of updating the existing one. Scoped to plain nullable string
  columns only; not yet extended to DataGrid child-row nested writes. See
  `docs/knowledge/import-key-null-empty-equivalence.md`.
- **An entity with `x-generate.edit: false` (create-only) is now fully protected against an
  orphaned edit page**: its Server Action now throws instead of silently creating a
  duplicate row when handed an existing record's id, and its view page no longer offers an
  Edit link regardless of the caller's `permissions.update`. See
  `docs/knowledge/create-only-upsert-rejects-update-intent.md` and
  `docs/knowledge/view-page-hides-edit-link-for-immutable-entities.md`.
- **A readonly field (`x-readonly`/`x-readonly-fields`) is no longer read from client input
  at all on save** — not FormData, not a POST/PUT body, not even as a generated service
  function's parameter — closing a gap where a hand-written custom validation rule reading
  the field directly (instead of the persisted `prevRow`) could see a fabricated coerced
  value and wrongly reject an unrelated save. See
  `docs/knowledge/pre-edit-row-handoff-to-custom-validation.md`.
- **A hand-written `service_validation_custom.ts` rejection of a present-but-invalid value
  no longer renders as the generic "field is required" text** a genuinely-missing value
  gets — `AppError`/`ActionFailure` now carries a `reason: 'missing' | 'invalid'`, rendered
  via a distinct i18n key. See `docs/knowledge/error-message-framework.md`.
- **A field narrowed via `x-autocomplete-context` no longer offers an unfiltered default
  candidate list before the user types anything** — it now live-refetches through the
  context-aware search action on mount and whenever the sibling context field changes.
- **A view's `x-readonly-fields` declaration no longer leaks onto every other view built on
  the same Prisma model** — it now stays scoped to the view entity that declares it. No
  current schema is affected. See `docs/knowledge/readonly-field-form-rendering.md`.
- **`x-readonly-fields`/`x-readonly` declared on a DataGrid child entity now actually takes
  effect** — the column renders non-editable and the write path no longer accepts a
  client-sent value for it. No current schema is affected. See
  `docs/knowledge/readonly-field-form-rendering.md`.
- **A CSV-import match key on an optional plain scalar column no longer treats an empty cell
  and a stored `NULL` as different values** — re-importing a row with a blank key column now
  matches the existing `NULL`/`''` row instead of creating a duplicate. See
  `docs/knowledge/import-key-null-empty-equivalence.md`.

- **A proxy view (`parent != model`) with `x-generate.list: true` could fail to get a
  sidebar nav entry, or fail to have it retracted on teardown** — three gates in the add
  path were keyed on `parent == model` (false for every proxy view), and `cleanup.py` kept
  its own separate, narrower copy of the same predicate. Both paths now share one
  `nav_config.nav_list_entities()` function; nav group/order can now differ per proxy view
  sharing a model, and `grant-all-permissions.ts` no longer permanently excludes every
  proxy view (now scoped to `x-self-only: {admin_bypass: true}` only). See
  `docs/knowledge/proxy-view-nav-and-permission-scope.md`.
- **`GET /api/user/{id}` leaked the password hash and raw `api_key`** when an entity's
  `x-generate.fields` allowlist omitted a write-only column (this repo's own `user`
  entity) — the write-only field set is now derived from the entity's full property set
  instead of the allowlisted subset. See `docs/knowledge/code-generation-custom-extensions.md`.
- **`db:createApiUserWithPermission` (test fixture) never enrolled its actor in any
  organization**, causing generated `4.4`/`4.5` FK-read-permission tests to 404 before
  reaching the scenario under test. The fixture now accepts an optional `organizationId`
  for `should_filter_by_org` entities. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.
- **`get_field_metas()` (test generator) mis-categorized a direct-attachment FK field as a
  plain text column**, breaking generated fill/clear test helpers for it — direct-attachment
  fields are now excluded from that generic machinery, the same as an internal bridge FK. See
  `docs/knowledge/schema-yaml-configuration.md`.
- **i18n key collection for a child table's column headers didn't recognize `type: direct`**,
  leaving a stray unreferenced key in `messages/*.json` for a direct-attachment field
  reachable as a many-to-many child's column. See `docs/knowledge/schema-yaml-configuration.md`.
- **`build_anonymize_user_context()`'s PII-scrub field ordering anchor was a literal field
  name (`'image'`) that stopped matching once renamed to `image_id`** — anchor updated. See
  `docs/knowledge/schema-yaml-configuration.md`.
- **The comment/mention creator avatar select assumed `user.image` is always a
  direct-attachment FK**, breaking the build for a schema where `x-mention: true` but
  `user.image` is still a plain `format: uri` string column. The select now branches on the
  consuming schema's own `user` shape. See `docs/knowledge/schema-yaml-configuration.md`.

- **An `x-internal` entity's named-constant parent prefix (e.g. `COMMENT_REACTION_TYPES`)
  was derived from schema declaration order**, so an unrelated schema edit could silently
  rename an already-shipped constant. Now resolved from an explicit
  `x-relationship: {constantParent: true}` declaration; generation fails closed if none (or
  more than one) is marked. See `docs/knowledge/schema-yaml-configuration.md`.
- **`lib/attachment/direct_actions.ts` was emitted unconditionally, breaking `tsc`/`next
  build` for every consumer regardless of whether they used the direct-attachment-FK
  feature.** Now emitted only when an entity actually declares
  `x-relationship: {target: attachment, type: direct}`, with an actionable error if the
  `attachable_id`-nullable Prisma prerequisite is missing. See
  `docs/knowledge/schema-yaml-configuration.md`.
- **An `x-uri-kind: link` field could never be set through the create/edit form** (no input
  was rendered for it at all, and editing silently erased any existing value), **and the
  list page's DataGrid never rendered it as a link either** (only a parent-embedded
  `BridgeGrid` did). Both gaps are closed; an `x-uri-kind: image` field is unaffected and by
  design still never draws an image inside any DataGrid cell. See
  `docs/knowledge/schema-yaml-configuration.md` and
  `docs/knowledge/readonly-field-form-rendering.md`.
- **The new `x-scheduled-task` mechanism (Vercel Cron) had six rough edges, now closed**:
  the generated route now exports `GET` (Vercel Cron's actual invocation method) alongside
  `POST`; `vercel.json`'s `crons` array is now written automatically instead of a hand-copy
  step that `prj:sync` could silently clobber; the required system-actor account is now
  resolved by a seeded fixed-email lookup instead of an unset-by-default
  `SCHEDULED_TASK_ACTOR_ID` env var that 500'd every invocation until someone set it;
  schemas declaring over 100 scheduled tasks (Vercel's per-project cron limit) now fail at
  generate time instead of at deploy; and `scripts/vercel-env.sh` now actually injects
  `NEXT_PUBLIC_APP_TITLE`/`NEXT_PUBLIC_APP_COPYRIGHT` (previously documented but never
  injected). See `docs/knowledge/scheduled-task-operations.md`, which also now correctly
  documents that an unset `CRON_SECRET` blocks only Vercel Cron's own request, not manual
  invocation.
- **Fixed a silent output-path collision between polymorphic attachable-bridge actions and a
  standard per-entity CRUD actions file** when `attachment` itself gets an `x-generate` block
  — bridge actions now write to `lib/attachment/bridge_actions.ts` instead of clobbering
  `lib/attachment/actions.ts`. No consumer currently sets `x-generate` on `attachment`. See
  `docs/knowledge/architecture-overview.md`.
- **Fixed generated approval-flow test helpers never granting synthetic test users
  membership in a membership-scoped FK dependency**, which made the create-form FK
  autocomplete always return zero candidates and several approval tests unable to
  submit/view the record. See `docs/knowledge/testing-cypress.md`.
- **Fixed a Decimal or date field crashing the write when a user cleared it**, for any
  non-nullable-but-not-required column — now falls back to the field's schema default;
  DataGrid child rows also gained the same validation (previously none at all). See
  `docs/knowledge/decimal-and-date-empty-string-clear-crash.md`.
- **Fixed multiple generated UI e2e test gaps** found via a 68-entity real-world schema run
  (imprecise row/card lookups, a DataGrid child FK single-select ignoring `labelField`, a
  non-nullable `format: uri` field skipped in populate-helper data, an unsearchable
  composite-label autocomplete token) — 14 previously-failing UI e2e specs pass after the
  fix, no new failures elsewhere. See `docs/knowledge/testing-cypress.md`.
- **Fixed generated UI e2e tests asserting a placeholder string instead of the actual value
  for entities whose list/card primary field is a string or Prisma nativeEnum column.** See
  `docs/knowledge/testing-cypress.md`.
- **Fixed `lib/_decimal.ts` pulling the Node.js Prisma client into every client-side
  bundle**, surfacing as `TurbopackInternalError` on any consumer schema with a Decimal
  field — the Prisma-free formatter is now split into its own module. See
  `docs/knowledge/decimal-client-server-boundary-gate-limitation.md`.
- **Fixed two generated-app defects surfaced by UI e2e testing**: read-only Decimal display
  rendered `Decimal.toString()` verbatim instead of the declared scale; and an optional
  one-to-one selector FK autocomplete returned zero candidates as soon as the user typed. See
  `docs/knowledge/decimal-field-generator-support.md`.
- **Fixed the generated Stripe integration stubs throwing at module top level when a
  required Stripe env var was unset**, failing the production `next build` itself for any
  consumer with `x-payment: true` — both checks now defer to first use. See
  `docs/knowledge/stripe-payment-integration.md`.
- **The Gantt-chart projection (`x-display.chart`) now correctly serializes a required
  Decimal column** (previously a `TS2322` at build time) **and has been extended to a
  required plain Int/Float scalar and a required DateTime column** other than the chart's
  own start/end pair (previously silently dropped, or also a build-time `TS2322`); a
  required Boolean column is now explicitly excluded, and an unrecognized required type
  fails generation loudly instead of vanishing. See `.claude/commands/update-generator.md`
  Completion gate steps 8-9.
- **Fixed a one-to-one selector's "available options" getter not serializing the target
  entity's Decimal columns**, a `TS2322` at build time. See
  `.claude/commands/update-generator.md` Completion gate step 7.
- **Fixed `split_same_target_fk_deps()` leaving a stale reference after a same-target
  multi-FK split** (e.g. two FKs on one entity both pointing at the same target) —
  rendered a generated test helper with a `ReferenceError` at test-run time. Also fixed a
  related dependency-ordering bug. See
  `docs/knowledge/self-ref-dep-fixture-unique-collision.md`.
- **Removed the hardcoded Stripe `apiVersion` literal from the `x-payment` stub** — it went
  stale on every SDK bump and would eventually break `next build`. The SDK's own default is
  confirmed behaviorally identical. See `docs/knowledge/stripe-payment-integration.md`.
- **Fixed two generator defects**: a required one-to-one selector FK made the generated
  `page_new.tsx` unbuildable (see `.claude/commands/update-generator.md` Completion gate
  step 6); and a parent with no date field of its own but an inline DataGrid child with one
  generated a `dayjs()` call with no import (see
  `docs/knowledge/writable-default-value-fix.md`). Neither defect is currently live in this
  repo's own schema, app-template, or app-generator's proj_g schema.
- **Fixed `npm run lint:prj`'s fail-closed condition being too strict**: a consumer whose
  `prj/` holds only non-TypeScript content now passes with an explicit measurement message
  instead of failing outright; the genuine "could not measure" cases are unchanged. See
  `docs/knowledge/consumer-prj-scoped-lint.md`.
- **Fixed a pending SSL-mode deprecation against Neon connections**: `sslmode=require`/
  `prefer`/`verify-ca` connection strings are now rewritten to `verify-full` (currently
  behaviorally identical, immune to a future `pg` major-version change); URLs with no
  `sslmode` param are unaffected. See
  `docs/knowledge/pg-connection-string-sslmode-deprecation.md`.

- **Server Action errors (permission denied, unique-constraint violations, stale updates, and
  more) showed an opaque "Minified React error #441" screen instead of the underlying reason**
  — Next.js strips a thrown error's message at the Server Components render boundary in
  production. Fixed via a typed `AppError`/`ActionFailure` taxonomy (`lib/_errors.ts`): named
  throw sites now throw `AppError`, and `upsertXxx`/`removeXxx` (including bulk delete) catch it
  and return a value instead of letting it propagate, rendered via a new `Errors` i18n
  namespace. A genuine DB-level unique-constraint violation (`P2002`) is now also converted to
  `AppError('CONFLICT', ...)` instead of surfacing as an uncaught exception. Org isolation
  violations continue to surface as `NOT_FOUND`, never "permission denied" (would leak that the
  record exists in another org). See `docs/knowledge/error-message-framework.md`.
- **`get<Entity>ChunkForExport()` silently exported zero rows (a `200` with an empty CSV body,
  not an error) for an `X-API-Key`-only caller with genuine `read` permission** — one of its two
  permission-check branches resolved the acting user from the session cookie instead of the
  already-authenticated actor, so a caller with no session cookie always resolved to no
  permissions. Both branches now use the same resolved `userId`. See
  `docs/knowledge/multi-tenancy-and-permissions.md`.
- **`FormUpsert`'s readonly-field display was type-blind**, showing a relation as a raw FK id
  with a nonexistent i18n key instead of its resolved label (enum/date/boolean/image readonly
  fields were also affected, though only cosmetically). Now reuses `FormView`'s existing
  per-type display dispatch; an `x-readonly-fields` entry that doesn't resolve to an actual
  property now fails at generation time instead of silently leaving the field editable. See
  `docs/knowledge/readonly-field-form-rendering.md`.
- **Generated approval-flow Cypress tests used unscoped, page-wide selectors that could match
  more than one row** — a "re-submit a rejected request" test's `[aria-label="Re-submit"]`
  lookup matched every rejected `approval_request` row when an entity has more than one
  applicable `approval_flow`, and a related, previously-invisible bug surfaced while fixing it:
  `helper_context()`'s per-dependency loop reused the loop variable name `title`, permanently
  overwriting the entity's own title for the rest of the function once more than one FK pointed
  at the same target — corrupting the seeded approver-role name text the newly-scoped selector
  now actually checks. Both are fixed; the sibling `Approve`/`Reject` selectors in the same
  tests carry the identical unscoped-selector hazard and are noted as a follow-up, out of this
  fix's scope. See `docs/knowledge/testing-cypress.md`.
- **An org-scoped entity's `organization` relationship can now be declared optional, without
  breaking CREATE, making org-less rows invisible, or leaving them permanently un-updatable.**
  Declaring the relationship optional exposed four separate sites that assumed it was always
  set: the CREATE-path membership check (a real `next build` compile error once the value could
  be `string | null`); every generated read/write scope filter, which never matches SQL `NULL`
  (making an org-less row invisible to every actor including its own creator); the
  update/delete existence check (thrown `Not found` even for the row's own creator); and
  cross-entity global search. All four are now covered by a shared `org_relationship_optional`
  NULL-admission flag applied everywhere the current model's own org scoping is checked. A
  required-org entity's generated output is unaffected. See
  `docs/knowledge/org-optional-entity-support.md`.
- **A generated "edits with mixed changes" test for a `user`-FK primary field could select a
  row that was never actually seeded**, failing the autocomplete assertion — the edit path
  wasn't routed through the same dependency populator the create path already used for this
  field shape. Now routed consistently. See
  `docs/knowledge/edit-test-fk-primary-target-uniqueness.md`.
- **A generated Cypress test's per-entity `callIndex` uniqueness counter persisted for the life
  of the Cypress plugin process instead of resetting per test case**, so two `it()` blocks in
  the same spec calling the same populate helper could get different, test-order-dependent
  values and fail. A reset task is now called at the top of every generated spec's `beforeEach`
  (desktop, mobile, and API). Hand-written specs calling the same populate functions are not
  automatically covered — see `docs/knowledge/cmd614-test-data-uniqueness-design.md` §6.2.
- **`api_import_route.ts.jinja2` could reference `formatLabelValue()` with no import once a
  composite labelField segment needed date/time formatting, breaking the TS build** — a static
  read of the Jinja2 source can't see that the spliced-in label expression calls it. The import
  is now gated on the same `has_format` signal 7 other templates already use for it. Also fixed
  in the same file: a misplaced `eslint-disable-next-line` comment that silently suppressed
  nothing. See `docs/knowledge/cmd607-generator-lint-debt-fix.md`.
- **Generated UI test scaffolding no longer tries to fill an `x-server-value` field through the
  form** — two code paths generated a fill command against a field that's always excluded from
  form input by design, failing the test outright. See
  `docs/knowledge/x-server-value-actor-delegation.md`.
- **A generated test helper's find-or-create block gave `create()` a composite-labelField
  `include` but not the paired `findFirst()`**, a latent type error invisible to every gate
  (Cypress support files aren't type-checked). Both call sites in all 5 affected template
  shapes now get the same conditional include. See
  `docs/knowledge/composite-labelfield-helper-findfirst-include-mismatch.md`.
- **CSV import of an entity with a required internal bridge FK (e.g. `approvable_id` on an
  `x-approval` entity) was broken in two stages of the same underlying gap.** The CSV
  CREATE-feasibility gate wrongly counted a bridge FK as an unfillable required column, forcing
  the entire generated import route to the "not supported" stub for such an entity — fixed by
  excluding bridge FKs from that gate, the same way they're already excluded from CSV export.
  That in turn exposed a second gap: the commit-time CREATE path built its Prisma `create()`
  call from dry-run data alone, bypassing the auto-create-bridge-FK mechanism the normal
  service function already uses, so commit still failed with a Prisma validation error after a
  dry run had already reported success. Both are fixed; entities without an auto-create
  one-to-one relation are unaffected. See
  `docs/knowledge/create-feasible-internal-bridge-fk-fix.md` and
  `docs/knowledge/import-create-missing-bridge-fk-fix.md`.
- **CSV import's dotted/composite-label FK lookup left `organization`-as-lookup-target
  completely unfiltered** — a CSV row could name any organization in the system, not just one
  the actor belongs to, and have it resolve and get attached. Now filtered to the actor's own
  associated organizations. See `docs/knowledge/csv-import-dotted-fk-org-filter.md`.
- **`approval_flow.preceded_by`/`followed_by` rendered a different label on the View page than
  on the Edit page for the same row** — the legacy mechanism causing the mismatch is removed
  entirely; both pages now render the same composite label via the existing shared helper.
  Self-referential many-to-many searches for this field now also narrow candidates to the same
  `entity_name` as the record being edited, since same-`entity_name` approval chains are an
  intentionally supported configuration (the narrowing half is covered by
  `docs/knowledge/same-entity-validation-socket.md`).
- **Generator-side lint debt invisible to CI** (CI's Lint job runs before `generate-code`, so
  it never saw output-only warnings): 83 eslint warnings across a Chai-assertion false
  positive, three dead-binding bugs in two templates, and 22 warnings from scattered scenario
  branches — reduced to 5 (pre-existing, out of scope). See
  `docs/knowledge/cmd607-generator-lint-debt-fix.md`.
- **`x-reservation` test-helper generation only ever resolved the pool entity's criteria-field
  FK, silently omitting any other required FK on the pool entity**, failing test seeding with a
  missing-required-column error for any pool entity with an extra required FK. All three
  affected generated-test code paths now resolve the pool entity's required FKs generally,
  including transitive chains. Entities whose pool has no extra required FK are unaffected. See
  `docs/knowledge/x-reservation-pool-entity-extra-fk-fix.md`.
- **A field with a dynamic Prisma `@default(...)` (e.g. `now()`) or an ignored static default
  (number/boolean/plain-string) silently lost that default on the "new" page when left
  untouched** — for a non-nullable `DateTime @default(now())` column this crashed `create()`
  outright; the others silently discarded the schema's declared default. The "new" page now
  seeds a writable default for all four field classes. Also fixed a related bug where a
  legitimate `0` default could be blanked. See `docs/knowledge/writable-default-value-fix.md`.
- **`npm run cleanup`'s defaults deleted write-once stubs while leaving true orphans behind,
  and running it right after `generate-code` silently deleted the entire just-generated tree**
  (every file hash-matches the fresh manifest and reads as pristine-deletable) — `cleanup` now
  defaults to `--prune-orphans --keep-stubs` and warns when run within a minute of generation;
  correct order is `cleanup` → `generate-code`, not the reverse. Also fixed: a bridge-child
  entity's `x-bridge` declaration was silently dropped when combined with `x-generate`, which
  would have skipped its `BridgeGrid.tsx` generation (no current consumer combines the two).
  See `docs/knowledge/cleanup.md` and `docs/knowledge/schema-restructuring-build-order.md`.

- **Generated Cypress test fixtures could crash or click the wrong row for entities with a
  self-referential FK** — a self-ref dependency record's create call had no find-or-create
  guard, so calling the populate helper more than once in the same spec could duplicate the row
  and trip a `@@unique` constraint; a substring-based row lookup could also click a self-ref
  decoy sharing a name prefix with the record under test. Both fixed: existing rows are now
  reused, and self-referential entities use an anchored exact-match lookup. See
  `docs/knowledge/self-ref-dep-fixture-unique-collision.md`.
- **`x-generate.invalidate` enabled with no handler/module produced code that could not
  build.** A write-once stub (`lib/{entity}/invalidate_handler.ts`) now throws a clear,
  actionable error until a human implements real invalidate logic — no default soft-delete
  behavior is introduced. A later regression made this same stub call
  `prisma.<model>.update()` unconditionally even for a model with no `invalidated_at` column,
  breaking the build again; the stub now only emits that default update when the column
  actually exists, falling back to the original throw otherwise. See
  `docs/knowledge/invalidate-no-handler-write-once-stub.md`.
- **Item-master entity naming was silently hardcoded to `product`/`product_id` throughout the
  ledger/split generator**, silently disabling several checks (including rendering an
  always-undefined property access) for any consumer naming its item-master entity or pool
  location/lot/expiration columns differently. `x-ledger-entities.<domain>` gains four new
  **required** keys (`itemField`, `locationField`, `lotField`, `expirationField`, no defaults —
  a domain missing any fails loudly). **Breaking schema-config change**: an existing consumer
  already declaring `x-ledger-entities` must add these four keys before its next
  `generate-code` run. See `docs/knowledge/appendix/inventory-reservation-split.md` §7-8.
- **Ledger row's location column is an id-FK, not a denormalized display string** — every
  write is a plain id copy from the pool entity, with no reverse string-to-row lookup anywhere.
  The FK is `onDelete: Restrict`; renaming a location remains possible, with `x-audit: true`
  recording who renamed it and when. See
  `docs/knowledge/appendix/inventory-reservation-split.md` §7.1-7.2 and
  `docs/knowledge/appendix/cmd562-location-id-fk-consumer-migration.md`.

- **`npm run cleanup` could wipe every translated `messages/ja.json` entry** — it deleted
  every Fields/EntityLabel/Nav key for any entity in the passed schema, including entities
  still in production use. `cleanup.py` no longer touches `messages/*.json` at all;
  `generate-code` now also warns when a freshly-added key was added to a non-English locale
  file, so a partial translation gap is visible. See `docs/knowledge/i18n-locale-routing.md`.
- **Re-submitting via the (since-retired) dedicated resubmit action/route never notified the
  approver** — that path was retired later in this cycle (see the edge-trigger entry under
  Changed above); today's ordinary-edit resubmission always creates a fresh row and notifies
  normally, per `docs/knowledge/appendix/approval-flow.md` §16.4/§16.6.
- Separately (still true today): a related payload bug — rejection notification's `status`
  field hardcoded to `'rejected'` even for a `terminal_rejected` outcome — is also fixed.
- **Fixed `migrate:deploy` running through Neon's pooled connection instead of a direct one**
  — Prisma's migration engine needs a session-scoped advisory lock a transaction-mode pooler
  doesn't guarantee. `prisma.config.ts` now prefers a new `DIRECT_URL` env var; **on Vercel
  specifically, config loading now throws if `DIRECT_URL` is unset.** GCP Cloud Run and
  local/CI are unaffected. See `docs/knowledge/prisma-direct-vs-pooled-connection.md`.
- **Fixed two generated Cypress scaffold bugs**: a form with 2+ DataGrid children could fail
  with a scroll-into-view element-count error (unscoped selectors matched every grid on the
  page); and DataGrid-child date/date-time/time edit cells rejected every typed value (wrong
  date format for the browser's native input). See `docs/knowledge/testing-cypress.md`.
- **Generated test helpers' `populate*Data`/`populate*FullData` silently shared one
  FK-dependency row across repeated calls in the same test, entangling logically independent
  scenarios** — both find-or-creates are now unconditional `create()`s with a per-entity
  `callIndex` counter, and dependency-record names switched from a suffix that collided
  byte-for-byte with the loop's own rows (`'Test {Title} 2'`) to a letter-indexed one
  (`'Test {Title} A'`/`'B'`). Generated fixtures are unaffected in form; the isolation matters
  for hand-written specs calling the same populate function more than once. See
  `docs/knowledge/cmd614-test-data-uniqueness-design.md` §3-4.4.
- **Fixed `exactRe()`'s exact-match Cypress helper being gated to only 2 self-referential
  entities**, even though the substring-collision problem it guards against isn't specific to
  them — widened to all entities. Also re-anchored two post-render cleanup helpers that had
  silently stopped firing after an earlier edit (see
  `docs/knowledge/cmd607-generator-lint-debt-fix.md` and
  `docs/knowledge/self-ref-dep-fixture-unique-collision.md` for this helper's own design/history).
- **Fixed 4 Completion gate docs running `npm run lint` after `generate-code`**, linting ~230
  more generated files than CI's own Lint job ever checks. `npm run lint` is now the first
  Completion gate step in all four. See
  `docs/knowledge/lint-gate-must-match-ci-precondition.md`.

- **Mention-collection loops read the wrong field off the comment relation** — two code paths
  read `c.creator_id`, but the comment type only declares `creator?: { id, name, image }` (a
  compile error on any schema whose `comment_has_mention` branch actually renders). Both now
  read `c.creator?.id`. See `docs/knowledge/mention-system.md`.
- **`searchMentionUserOptions()`'s permission-denied flag never reached the client** — Next.js
  Server Actions serialize return values through the RSC flight protocol, which drops a
  non-indexed property from an array, so the picker's "suggestions unavailable" message never
  rendered even though the server correctly computed the denial. Contract changed to a plain
  `{ options, permissionDenied }` object (the identical pattern in `getters.ts.jinja2`'s
  `searchXxxOptions()` is presumed to share this bug and is flagged, not fixed, here). Also
  fixed: a test-generation gate missed the commentable one-to-one bridge form (zero generated
  mention-UI test coverage for that pattern), and a dynamic import in `lib/prisma.ts` that
  broke any Cypress Node task depending on it. See `docs/knowledge/mention-system.md`.
- **Multi-stage approval chains never notified the next approver when their turn arrived** —
  every flow's approver was notified once at request-creation time, but a follow-on flow isn't
  actionable until its preceding flow(s) are approved, and nothing told those approvers when
  that moment came. Both the server action and REST route now send a new
  `approval_order_reached` notification once a flow's ordering constraint is satisfied. See
  `docs/knowledge/notification-triggers.md`.

- **CSV import dotted-FK org filter gap**: a dotted `x-import-key` lookup on an
  organization-scoped entity's CSV import route was not itself organization-filtered — a
  same-named row owned by a different organization could resolve and get linked to the
  importing actor's record. Now org-filtered whenever the lookup target has `organization_id`;
  system-global lookup targets (e.g. `role`) are correctly left unfiltered. Covers both CREATE
  and UPDATE. See `docs/knowledge/csv-import-dotted-fk-org-filter.md`.
- **CSV import silently dropped screen-editable FK columns not declared in `x-import-key`** —
  such a column had no write path at all, and the route answered `200 succeeded` while
  discarding it; a *declared* dotted-key FK was also never rewritten on UPDATE. Every
  screen-editable FK relation with a simple labelField is now resolvable and written on both
  CREATE and UPDATE; a column with genuinely no write path (composite labelField, or
  read-only) now rejects the import with a new `UNIMPORTABLE_COLUMN` error instead of silently
  succeeding. A KEY-field null→value transition still creates a phantom duplicate row rather
  than updating in place — a separate, deliberately-unfixed limitation. See
  `docs/knowledge/csv-import-non-key-fk-write-path.md`.
- **Fixed a HIGH-severity transitive CVE (fast-uri, GHSA-7p8r-x3mc-p8w7) blocking the
  Dependency Audit gate**, plus 6 moderate advisories, via narrow non-breaking `overrides`.
  `npm audit --omit=dev --audit-level=high` now reports 0 vulnerabilities.
- **Fixed `x-approval.set_fields` documentation contradicting the implementation** (only a
  mapping form is actually accepted, not the documented list-of-`{field, value}` form) —
  corrected the doc and added a `validate_schema()` check that now rejects a non-mapping
  `set_fields` before generation runs. See `docs/knowledge/appendix/approval-flow.md`.
- **`npm run lint` now enforces a warning ceiling** (`--max-warnings 20`) after 216
  unused-vars/expressions warnings had silently accumulated behind a config gap. The ceiling
  only ever ratchets down. See `docs/knowledge/lint-warning-ceiling-ratchet.md`.
- **Fixed generated-test Decimal values being a fixed literal that overflowed narrow
  `@db.Decimal(p, s)` columns** — test values are now derived from the column's own
  `x-decimal-scale`/`x-decimal-precision`, including the all-fractional edge case. See
  `docs/knowledge/decimal-field-generator-support.md`.

## [3.0.0] - 2026-07-30

> Consolidates the feature areas added since 2.0.0: GCP Cloud Run deployment,
> an audit log viewer, GDPR/data-protection tooling, attachment display
> opt-out, a round of performance hardening, an inventory ledger with
> receiving/reservation workflows and split actions, CSV import/export,
> extended search and FK autocomplete/auto-inference, notification
> persistence, the single-file entity schema format, `nativeEnum` type
> safety, and organization-isolation enforcement. Released as a major bump
> because the performance, data-protection, audit-log, notification-
> persistence, enum-type-safety, and organization-isolation work include
> breaking changes.
> Full upgrade steps: [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

### BREAKING
- **`statement_timeout` now enforced by default (soft breaking)** — the direct
  (PrismaPg) Prisma connection path (`lib/prisma.ts`) now applies a 30-second
  `statement_timeout` by default. Queries that previously ran unbounded (large
  exports, complex reports) will now fail with a timeout error if they exceed
  30 seconds. Configurable via the `STATEMENT_TIMEOUT_MS` env var; set it to a
  higher value or `0` to disable. Applies only to the direct-connection path —
  the Accelerate path (Vercel's `PRISMA_DATABASE_URL`) does not forward
  `statement_timeout` and is unaffected.
- **`pageSize > 200` now returns `400 Bad Request` (API contract breaking)** —
  generated REST API routes (`code_generator/templates/api_route.ts.jinja2`)
  previously truncated an over-limit `pageSize` query parameter to 200
  silently. They now reject it with `400 Bad Request`. Existing API clients
  that send `pageSize` above `MAX_PAGE_SIZE` (200) must cap the value
  client-side before upgrading.
- **`user.anonymized_at` column now required (soft breaking)** — the new
  `anonymizeUser()` GDPR-erasure function (`lib/compliance/anonymize_user.ts`)
  reads/writes `anonymized_at` on the `user` model. 3.0 adds the column as
  nullable. Pre-3.0 databases must add it: `prisma db push` or
  `prisma migrate deploy`. New nullable column — no backfill required (see
  [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md)).
- **`audit_log.actor_user_id` now enforces a foreign key to `user.id` (schema
  breaking)** — `prisma/schema.prisma`'s `audit_log.actor_user` relation
  (`onDelete: Restrict`) and the matching `user.audit_logs` back-relation were
  added in `ec2cbb8` ("fix: Show audit log page", 2026-06-26), after the
  2.0.0 cut (`git log`/`git blame` confirm both fields are absent at the
  `v2.0.0` tag). Pre-3.0 schemas have no such constraint. `prisma db push` /
  `prisma migrate deploy` will fail if any existing `audit_log.actor_user_id`
  value references a `user` row that no longer exists — possible because the
  pre-3.0 schema let a `user` be deleted without touching their audit history.
  Clean up orphaned rows first, e.g.
  `UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id IS NOT NULL
  AND actor_user_id NOT IN (SELECT id FROM "user");`. Going forward, deleting
  a `user` with existing `audit_log` rows is rejected instead of silently
  orphaning them.
- **`nativeEnum` promotion for 6 previously-`Int` enum fields** — if any
  generated application read or wrote these columns using raw integer values
  rather than the generated enum constants, those values may fail Prisma's
  enum validation after upgrade. Affected fields: `approval_request.status`,
  `reaction.type`, `attachment.type`, `dashboard_widget.chart_type`,
  `dashboard_widget.stack_mode`, `dashboard_widget.group_by_bucket`. `prisma
  db push` or `prisma migrate deploy` required.
- **Notification persistence requires the new `notification` table** — the
  in-memory SSE notification store was replaced with a Prisma-backed
  `notification` table. Until the table is created, `GET
  /api/notifications` and `POST /api/notifications/mark-read` throw and
  return `500` to every logged-in user (the bell icon is on the shared
  header); notification writes fail silently instead. `prisma db push` or
  `prisma migrate deploy` required.
- **Organization-scoped mutation paths now deny cross-org access** —
  generated API routes and server actions for org-scoped entities previously
  authorized update/delete/CSV-import-update purely via
  `creator_id`/`assignee_id`, without checking organization membership,
  allowing a user with `general.update`/`general.delete`/`general.import` to
  act on another organization's record by ID. Cross-organization requests
  now resolve to a deny (`404` on API routes, silent no-op on session
  actions). No schema change; only bites a deployment whose client or test
  code depended on the old (permissive) cross-org behavior.
- **nativeEnum member names normalized to lowercase snake_case** —
  `ApprovalRequestStatus` (`Pending`/`Approved`/`Rejected`/`TerminalRejected`
  → `pending`/`approved`/`rejected`/`terminal_rejected`) and `ReactionType`
  (`Like`/`Love`/`Laugh`/`Surprised`/`Sad` → lowercase) are the only two
  PascalCase nativeEnum types app-generator itself ships; an inventory
  across the full default schema + the app-template consumer schema found
  lowercase snake_case already the established majority (16/20 nativeEnum
  types, 61/80 members). `code_generator/validate.py` now rejects any
  nativeEnum member that isn't lowercase snake_case at generation time.
  Existing consumer data must be migrated — see
  [docs/knowledge/enum-member-naming.md](docs/knowledge/enum-member-naming.md)
  for the naming rule, rationale, consumer-impact list, and the exact
  migration SQL (verified against an isolated test database seeded with
  pre-migration rows).
- **`db:seed-tenant` now requires `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
  under `NODE_ENV=production`** — `scripts/seed-tenant.ts`
  previously seeded the bootstrap admin as `admin@example.com` /
  `password123` with a fixed `api_key` literal unconditionally; since
  app-generator is a public repo, any production deployment provisioned
  without a separate manual rotation shipped with a publicly known admin
  login. Every production-equivalent entry point (`vercel-build`,
  `build:full`, GCP's `gcp-seed.sh`) now fails fast unless both env vars are
  set, and always mints a fresh random `api_key` instead of the literal.
  `test`/`development` are unaffected — the fixed defaults are unchanged, so
  existing Cypress/vitest fixtures pinned to them keep working. See
  [docs/knowledge/seed-baseline-credential-hardening.md](docs/knowledge/seed-baseline-credential-hardening.md)
  for the required env vars and the remediation runbook for a deployment
  already seeded with the old defaults.

### Added
- **GCP Cloud Run deployment** (`x-cloud` annotation, opt-in — disabled unless
  `enabled: true` and `provider: gcp` are both set explicitly) — **Vercel
  remains the default deployment target when `x-cloud` is unset**; this adds
  GCP Cloud Run as a second, opt-in target, alongside:
  multi-stage/non-root/`HEALTHCHECK` `Dockerfile`, `.dockerignore`,
  `next.config.ts` `output: 'standalone'`, a GCS Signed URL upload route
  (overrides the default Vercel Blob route), a V4 Signed URL proxy route, and
  `proxy.ts` header rewriting so Cloud Run's internal `:8080` port never leaks
  into a redirect `Location` header. Idempotent environment automation scripts
  (`scripts/gcp-env.sh`, `gcp-setup.sh`, `gcp-deploy.sh`, `gcp-seed.sh`,
  `gcp-teardown.sh`) provision Cloud SQL/service account/Upstash/Secret
  Manager/GCS and drive build+migrate+deploy. See
  [docs/knowledge/gcp-automation-design.md](docs/knowledge/gcp-automation-design.md).
  Pure opt-in — zero impact on existing (Vercel-default) apps.
- **Audit log viewer** — `app/[locale]/audit_log/page.tsx`, a schema-agnostic
  read-only viewer over the `audit_log` model. `lib/audit_log/getters.ts`
  resolves the actor user via FK join, restricts the raw `metadata` JSON to the
  admin-only detail page, and paginates via `CardListPagination`. The
  `audit_log` model's core columns (id/actor_user_id/action/target_table/
  target_id/metadata/created_at) predate 2.0.0, but the `actor_user` relation
  it's joined through is new in 3.0 — see BREAKING above.
- **Data protection / GDPR compliance** — `x-pii` annotation (`direct` /
  `sensitive` / `indirect` classification), `anonymizeUser()` scrub function
  (irreversible, transactional, preserves referential integrity), `x-gdpr-mode`
  (model/field-level `internal` / `consumer` / `both` data-subject-scope
  classification — validated by `code_generator/validate.py` but not yet read
  by any codegen template, so it has no effect on generated code in 3.0),
  AES-256-GCM at-rest attachment filename encryption
  (`lib/compliance/attachment_name_crypto.ts`), and `x-mention` user-mention
  parsing in comments.
- **Attachment display opt-out** — `AttachmentSection` (`components/_standard/`)
  gains `showImages` / `showFiles` props (both default `true`) so image/file
  previews can be hidden per entity independently.
- **Performance hardening** — automatic FK index coverage
  (`scripts/add_required_indexes.py`, generator demo schema grew from 18 to 36
  indexes), a generated pg_trgm GIN index script
  (`scripts/create-gin-indexes.sql`, kept outside `prisma/schema.prisma` to
  avoid a `prisma migrate dev` drift loop), and a `SearchOpts.count: false`
  opt-out that skips both `COUNT(*)` queries in cross-entity search
  (returns `total: -1`).
- **Inventory ledger with `x-ledger-source`** — `inventory_transaction`
  ledger entity and `transactionable` bridge generated when a ledger
  top-level declaration is present in `json_schema.yaml`. Annotate a
  receiving-receipt line or billing-detail entity with `x-ledger-source`
  to emit write / adjust / move stub templates (`ledger_write_stub.ts`,
  `ledger_adjust_stub.ts`, `ledger_move_stub.ts`).
- **Receiving workflow** — top-level `ledger` / `transactionable` / `pool`
  entity declarations and `receiving_confirm_route.ts` generated for
  receiving-receipt schemas. Replaces the `x-receiving` mechanism removed
  earlier in the 3.0 development cycle.
- **Reservation ledger-transaction migration** — `x-reservation`'s internal
  state tracking migrated from slot-based to ledger-transaction strategy;
  each reservation records an `inventory_transaction` row for audit
  fidelity. `x-reservation` is scoped to exactly two roles: inventory
  allocation (`count` mode) and specific-resource reservation (`item`
  mode, e.g. a hotel room). Lifecycle transitions (approve/reject) for the
  entity that owns the reservation go through the generic Approval Flow
  System (`x-approval`) instead of a bespoke reservation-lifecycle
  mechanism — see **Removed** below for the `x-reservation.actions`
  sub-feature this supersedes.
- **Terminal rejection with `x-readonly-fields`** — annotate fields with
  `x-readonly-fields` to prevent edits after an entity reaches a terminal
  rejected state. `on_rejected_dispatch.ts` and `service_after_reject_stub.ts`
  are generated as once-stubs for custom post-rejection logic (not overwritten
  on `generate-code` re-runs). `rejection_reason` is wired into the reject
  route automatically.
- **Rejection event dispatch** (`on_rejected_dispatch`) — the `reject` API
  route fires `on_rejected_dispatch.ts` after a terminal rejection, enabling
  downstream logic such as notifications or inventory adjustments. Paired with
  `service_after_reject_stub.ts` for application-level customization.
- **Split action (`x-splittable`)** — annotate an entity with `x-splittable`
  to generate `SplitActionSection` (UI component) and `split_action_route.ts`
  (API). Enables lot-level split operations from the list or edit page without
  requiring a custom route.
- **CSV Export** — per-entity export route (`api_export_route.ts.jinja2`)
  generated when `x-generate.export: true` (default `true`). Exported columns
  match the entity's view-page field set; individual fields opt out via
  `x-generate.export: false` on the field declaration.
- **CSV Import** — user CSV import route (`api_import_route.ts.jinja2`) and
  `ImportModal.tsx` component generated when `x-generate.import: true`.
  Batch-processes rows server-side; access controlled via the `permission.import`
  grant per entity.
- **Search — child entities without a dedicated page** — entities with
  `x-page: false` now appear in global search results; hits resolve to the
  parent entity's edit page (method②). Previously only top-level entities
  appeared in search results.
- **FK Autocomplete custom filter hook** — `autocomplete_filter_stub.ts.jinja2`
  generated per entity for narrowing autocomplete and list results beyond the
  built-in permission filter. Wired into `SplitActionSection`'s FK context
  automatically.
- **FK scalar auto-inference** — FK scalar columns (e.g. `organization_id`)
  no longer need to be declared explicitly in `json_schema.yaml`; the generator
  derives them from Prisma relation properties, reducing per-entity schema
  verbosity.
- **`x-approval-lines` helpers** — annotate an approvable entity with
  `x-approval-lines` to generate pre-create / post-create helper functions that
  wire approval-line entities to inventory ledger operations.
- **Notification persistence** (DB-backed, cursor-based polling) — in-memory
  SSE notification store replaced with a Prisma-backed `notification` table.
  Cursor-based DB polling delivers unread notifications reliably across server
  restarts. See BREAKING above — the new table requires `prisma db push` on
  existing databases.
- **Single-file entity format** (`_detail` suffix retired) —
  `json_schema.yaml` entity declarations no longer require a paired `*_detail`
  block; the generator derives field types directly from the Prisma schema.
  `build_user_schema.py`'s Prisma-derivation pipeline updated accordingly.
- **enum type safety — `nativeEnum` promotion** — 6 previously-`Int` enum
  fields promoted to Prisma `nativeEnum`; generated code gains compile-time type
  checks. See BREAKING above for the affected fields and migration steps.
- **Organization isolation enforcement** — generated API routes for org-scoped
  entities deny create / update / delete across organization boundaries. A
  session-lookup miss in an org-filtered query now returns an explicit deny
  rather than a silent miss. See BREAKING above — a client or test relying on
  the old cross-org behavior will now be denied.

> **Backward compatibility**: GCP deployment and attachment display opt-out
> are non-breaking (pure opt-in / default-preserving). FK index coverage
> (`scripts/add_required_indexes.py`), the pg_trgm GIN index script
> (`scripts/create-gin-indexes.sql`), and the `SearchOpts.count: false`
> COUNT(*) opt-out are additive only and backward-compatible. The audit log
> viewer page itself adds no required input, but it surfaces data through a
> relation that is a breaking schema change — see BREAKING above. All eight
> items in **BREAKING** above require action before upgrading a pre-3.0
> deployment — see [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

### Fixed
- **Non-idempotent Cypress spec generation for enum labels** — `generate-code`
  used to feed `messages/en.json`'s existing content straight into the
  Cypress spec label lookup. A first run against a project with an
  incomplete/missing translation section produced specs with raw enum
  values (e.g. `'pie'`) baked in, while the same schema on a later run (once
  the file had been filled in) produced humanized labels (e.g. `'Pie'`) —
  and the raw-value run's specs no longer matched what the app actually
  renders, failing with `Expected to find content: 'pie' ... but never
  did`. `generate()` now always computes the schema-derived label defaults
  first and overlays any existing file values on top (file wins), so both
  runs agree and a consumer's custom translation is still honored. See
  `docs/knowledge/generate-code-idempotency.md`.

### Removed
- **`x-reservation.actions` sub-feature (2026-07-30 ruling)** — the declarative
  `ship` / `release` / `cancel` lifecycle-action mechanism under `x-reservation`
  (`reservation_actions.ts` generation, per-action
  `app/api/{parent}/[id]/actions/{ship,release,cancel}/route.ts` handlers, and the
  `ReservationActionButtons` UI component) has been removed. `x-reservation` is
  retained, scoped to exactly two roles: (1) inventory allocation (`count` mode) and
  (2) specific-resource reservation (`item` mode, e.g. a hotel `room`). Approval/
  rejection lifecycle for the owning entity goes through the generic Approval Flow
  System's `approve` / (terminal) `reject` instead (`x-approval`). No entity in the
  default schema or any known consumer schema ever declared an `actions` block, so
  this closes zero generated-output diff for existing apps — confirmed by comparing
  `generate-code` output before/after this change (identical). `code_generator/
  validate.py` now hard-rejects any schema that still declares `x-reservation.actions`.
  See [docs/knowledge/appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md)
  §1.1.

## [2.0.0] - 2026-06-25

> Consolidates the unreleased 1.5 feature set and corrects two breaking changes
> that shipped silently in 1.4 (comment reactions) and 1.5-dev (approval
> dispatch). Released as a major bump rather than patches because 1.5 was never
> announced. Full upgrade steps: [docs/UPGRADE-2.0.md](docs/UPGRADE-2.0.md).

### BREAKING
- **`reaction` model now required** (comment reactions, static since 1.4) — the
  comment-reaction code (`app/api/comment/[commentId]/reactions/toggle/route.ts`,
  `lib/db_table/actions.ts`, `CommentReactionBar.tsx`) calls `prisma.reaction.*`
  unconditionally, but the generator did not emit the model, so 1.3-era schemas
  failed to build. 1.4 adds `reaction` (+ `user`/`comment` relations,
  `@@unique([comment_id, user_id, type])`, indexes). Pre-1.4 databases must add
  the table: `prisma db push`, or `docs/sql/2.0-reaction.sql`. New empty table —
  no backfill.
- **`approvable.approved_at` column now required** (approval dispatch) —
  `approve/route.ts` and `lib/approval_request/actions.ts` read/write
  `approved_at` unconditionally as the fire-once idempotency flag, but the
  generator did not emit the column. 2.0 adds the nullable column. Pre-2.0
  databases must add it (`prisma db push`) and run the already-approved backfill
  so historical items are not re-dispatched: `docs/sql/2.0-approved_at-backfill.sql`.
- Both are additive (new table / new nullable column / new indexes), so
  `prisma db push` applies them without data loss. Verified non-breaking back to
  1.0 once present.

### Added
- **Cross-entity full-text search** (`x-generate.search: true`) via PostgreSQL FTS + pg_trgm + pg_bigm:
  - `GET /api/search` REST endpoint generated when searchable entities exist; UNION ALL query across all opted-in entities with tenant and permission filters applied per entity
  - `app/[locale]/search/page.tsx` global search UI (mobile-responsive client component) with search box, entity-type chip per result, snippet, and "View details" link
  - Facets — per-entity hit counts returned in `facets` field; rendered as filter chips above results
  - Snippet highlight — `ts_headline` output with XSS-safe `<<<`/`>>>` markers converted to `<mark>` tags in the UI
  - `text_fields` auto-derivation from entity properties: excludes PKs, FKs (`*_id`), enum fields, CUID-pattern strings, date/URI formats, and `x-search: false` opt-outs; entities left with no text fields are skipped from UNION
  - Authorization reuse: search WHERE clauses use the same `build<Entity>AccessWhere` / `RichPermissions` logic as list pages — no separate permission configuration needed
  - `x-audit: true` entities default to `search: false` (audit-safe by default); opt in with `x-generate.search: true`
  - `x-search.org_id_field` hint for entities where the organization key is not `organization_id` (e.g., `organization_detail.id`)
  - Global header search icon linking to `/search` (authenticated users only); i18n keys `Header.search` / `Header.searchAriaLabel`
- **Approval event dispatch** (DP-1~4) — post-approval hooks fired on `approve`:
  - `approvable.approved_at` DB timestamp flag for fire-once idempotency (prevents re-firing on re-approval)
  - `x-approval.on_approved.set_fields` — arbitrary field updates performed at approval time; integer/enum target fields receive the correct integer index (not a label string)
  - `x-approval.on_approved.emit_hook` — generated `service_after_approve.ts` once-stub for custom post-approval logic (not overwritten by `generate-code` re-runs)
  - `on_approved_dispatch.ts` generated per approvable entity; wired into both the API key (`approve/route.ts`) and server-action (`actions.ts`) approval paths

### Changed
- **`x-ui.rows`** — textarea row count is now schema-driven for any string field via `x-ui.rows: N` in the schema; previously only `description` fields had a hardcoded 4-row default
- **`x-ui.width`** — control form-field width on desktop; integer = 1–12 grid columns, string = literal CSS; mobile always 100%
- **Mobile header** — Setting link and Sign Out button hidden on mobile (`md:hidden`) to prevent header overflow; a mobile-only account section (Setting + Sign Out) added to the sidebar drawer with an `<hr>` separator

### Fixed
- Approval flow: the code generator updated to generate service_after_create.ts stub with approval requests for entities using approval flow

> **Backward compatibility**: Cross-entity search is opt-in per entity (`x-generate.search: true`). Approval event dispatch requires `x-approval.on_approved` in the schema to activate. **Correction:** the pre-release 1.5 note claimed "no breaking changes" — that was wrong. Upgrading a pre-2.0 database requires the additive schema changes listed in the **BREAKING** section above; see [docs/UPGRADE-2.0.md](docs/UPGRADE-2.0.md).

## [1.4.0] - 2026-06-18

### Added
- **Comment reactions** — reaction buttons on comment threads:
  - Integer-enum reaction kinds backed by named constants (`reaction_constants.ts`)
  - Per-comment toggle endpoint generated (`/api/comment/{commentId}/reactions/toggle`)
  - Batched reaction aggregation (single grouped query) and parent-owner read authorization
  - `CommentReactionBar` rendered inline within comment threads
- **Generalized bridge pattern** — the bridge mechanism previously dedicated to comments and attachments is now a reusable, schema-level relationship capability:
  - Real one-to-one relations via an internal through-table (`<model>able`) — no extra FK columns on the parent, and parent autocomplete is preserved
  - Internal bridge tables are omitted from the JSON schema output
  - Parent-label resolution (`labelField` → `x-display` primary → fallback), parent-context-only child creation, read-only parent fields on child forms, and child `DataGrid` lists on parent edit pages

### Changed
- **Wrapper components (round 2)** — auto-generated code no longer depends on MUI directly. Generated components import shared `App*` wrappers from `components/ui/` instead of `@mui/*`:
  - Hybrid wrapper API; `sx` confined to wrapper internals; icons referenced by name; public prop types defined independently of MUI
  - Outcome: MUI imports eliminated from generated output (provider setup excepted)
- **UI improvements** — consumer-grade default styling for generated apps: refreshed theme tokens (header / sidebar / footer), MUI palette and typography (Inter / Noto Sans JP), rounded surfaces, and responsive list/card layouts

> **Backward compatibility**: ~~Non-breaking from v1.3. Existing schemas work unchanged; comment reactions and the generalized bridge are opt-in. No breaking changes.~~ Comment reactions feature turned out to be breaking. See changelog for 2.0.0.

## [1.3.0] - 2026-06-10

### Added
- **Dashboard charts** — full chart rendering is now generated for entities with `x-display.dashboard: true`:
  - Chart types: `column`, `bar`, `line`, `pie` (string discriminator in schema via `chart_type`)
  - Stacking modes: `grouped`, `stacked`, `standardized` with `series_field` support
  - Timestamp bucketing and typed multi-condition filters (number / datetime)
  - CSV and Excel export per chart widget
  - REST aggregate endpoint (`/api/{entity}/aggregate`) generated alongside CRUD endpoints
  - Audit FK columns (`creator_id` / `updater_id`) added to dashboard catalog
- **Inventory reservation** (`x-reservation`) — schema-level opt-in for capacity and inventory management:
  - `mode: count` — conditional `UPDATE` on a numeric counter column (e.g., purchase order quantity reservation)
  - `mode: item` — row-level lock via a per-entity `inventory_allocation` bridge table
  - Schema validation enforced at `validate.py` with pytest coverage
  - E2E Cypress test generator templates for reservation flows
- **Integer enums** — `type: integer` fields with `enum` (string label array, values correspond to array indices) emit integer `Int` columns in Prisma (e.g., `status Int @default(0)`); dashboard fields (`chart_type`, `stack_mode`, `group_by_bucket`) migrated to integer enum
- **Wrapper component architecture** — per-entity generated components now use shared wrappers from `components/_standard/` (statically provided; not overwritten by `generate-code` re-runs):
  - Phase 1: `page_list` wrapper + `components/ui` scaffold
  - Phase 2: `FormUpsert` / `FormView` field wrappers
  - Phase 3: relation and accordion wrappers
  - Phase 4: `FormView` detail shell

### Fixed
- Optional primary FK now correctly included in `populateData` and POST body generation
- Read-only list correctly rendered for one-to-many with independent children and mandatory FK from child to parent
- E2E test regression introduced by integer enum migration resolved
- `Prisma.raw` removed from dashboard aggregation; native Prisma query builder used throughout
- `generate-code` now respects schema-defined default for integer enum fields in child-grid `createNew`

> **Backward compatibility**: Non-destructive from v1.2. Old schema is still usable as it is.
> `x-reservation`: New notation is necessary only if new features are used
> No Breaking Changes

## [1.2.0] - 2026-06-04

<!-- Security tracking: upstream-pending vulnerabilities -->
<!-- D1: prisma -> @hono/node-server (CVSS 5.3) - awaiting upstream fix -->
<!-- D3: cypress -> qs DoS (CVSS 5.3) - awaiting upstream fix in cypress -->

### Added
- Virtual display columns: fields that do not exist in `properties` under `x-display.table` can now be declared as display-only columns (virtual columns).
  Value supply is handled by a per-entity async bulk resolver in `lib/{entity}/virtual_resolvers.ts` (`resolveVirtualColumns(rows)`), and generate-code does not overwrite existing files.
  When custom logic is absent, the default is an empty string.
- Virtual resolver guide: recorded the spec of the async/bulk/per-entity single-file resolver in `docs/knowledge/virtual-resolver-guide.md`

### Fixed
- Deep labelField Prisma include merge: fixed the issue that relations with nested `label_field` are not merged correctly (commit 7aab3c9).

## [1.1.0]

### Added
- Default-deny authorization: new users start with zero permissions; Administrators
  must explicitly grant entity-level permissions via the Permission management UI
  or `db:grantAllPermissions` script. Role-based access control is enforced at the
  API layer (`lib/authz.ts`).
- Multi-factor authentication (MFA) via TOTP:
  - Time-based one-time password (TOTP) support
  - AES-256-GCM encrypted secret storage
  - 8 recovery codes generated at enrollment, stored as bcrypt hashes
  - Self-service enrollment UI at Settings → Security (`/setting/mfa`)
