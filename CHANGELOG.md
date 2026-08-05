# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [Unreleased]

### Security
- **Server-action path can no longer bypass multi-stage approval ordering** (cmd_540): the
  REST route (`app/api/approval_request/[id]/{approve,reject}/route.ts`) enforced
  `preceded_by` ordering via `assertApprovalOrder()`, but the server action
  (`lib/approval_request/actions_core.ts`'s `approveApprovalRequest`/`rejectApprovalRequest`,
  reachable directly via Next.js Server Action RPC from any authenticated client) did not —
  `ApprovalSection.tsx`'s `precedingApproved` check only hides the button client-side, it is
  not an authorization boundary. Reproduced against a real database (a later-stage approval
  succeeded while its preceding stage was still pending) before fixing; both entry points now
  call the same `assertApprovalOrder()` gate, so rejection wording is identical. See
  `docs/knowledge/appendix/approval-flow.md` §16.6.1 and
  `test/flows/approval_order_bypass.test.ts`.

### Fixed
- **`npm run cleanup` could wipe every translated `messages/ja.json` entry** (cmd_560):
  `cleanup.py` deleted every Fields/EntityLabel/Nav key belonging to any entity in the
  passed schema from `messages/*.json` — including entries for entities still in
  production use, not just genuinely removed ones. Since `npm run cleanup` always
  rebuilds its schema argument from whatever `json_schema.yaml` currently says, running
  it while a temp fixture entity was still present in the schema (a normal
  fixture-testing workflow — remove the fixture's generated files before reverting the
  schema file) wiped every real entity's translated keys too; a subsequent
  `generate-code` then refilled them with the English schema default, since
  `generators_i18n.py`'s own `_update_json` only fills genuinely missing keys.
  `cleanup.py` no longer touches `messages/*.json` at all. `generate-code` also now
  prints a `WARNING: untranslated keys added` line in the build log naming any key
  freshly added to a non-English locale file, so a partial translation gap is visible
  instead of silently looking like a fully-translated run. See
  `docs/knowledge/i18n-locale-routing.md` "`messages/*.json` are append-only, never
  generator-truncated".

- **Re-submitting a rejected approval request never notified the approver** (cmd_539):
  `resubmitApprovalRequest()` (both the server action in
  `lib/approval_request/actions_core.ts` and the REST route
  `app/api/approval_request/[id]/resubmit/route.ts`) transitions status back to `pending` by
  re-using the existing `approval_request` row rather than creating a new one, so
  `notifyApprovalRequestCreated()` — wired only into the creation path — never re-fired for a
  resubmission; approver-role holders were never told a rejected request needed their attention
  again. Both paths now call it again after the status flip. A related payload bug was fixed
  alongside it: the rejection notification's `status` field was hard-coded to `'rejected'` even
  for a `terminal_rejected` outcome (the notification itself always fired; only the payload was
  wrong). See `docs/knowledge/appendix/approval-flow.md` §16.6 and
  `docs/knowledge/notification-triggers.md`.

### Internal
- **`cypress/support/db-helpers.ts`/`generated-tasks.ts` were stale, missing `personal_note`**
  (cmd_560): these committed, generator-written files predate the `personal_note` entity
  (added later in the `x-self-only` Stage 1 work) and were never regenerated afterward —
  `resetTestDatabase()`'s cleanup ordering never deleted `personal_note` rows, so its later
  `user.deleteMany()` step hit `Foreign key constraint violated on the constraint:
  personal_note_creator_id_fkey` in the `before each` hook of any spec running after
  `personal_note` rows existed, cascading into 8 of 19 `test:e2e:cy:api` spec files failing.
  Unrelated to the `messages/*.json` fix above; discovered only because it blocked verifying
  that fix's own e2e gate, and bundled into the same PR to keep the gate green. Re-ran
  `npm run generate-code` and committed the resulting `db-helpers.ts`/`generated-tasks.ts`
  (now include `personal_note` in the Level-2 delete order, `ALL_ENTITIES`, and the three
  `db:populatePersonalNote*` tasks).

### Added
- **FK autocomplete search now derives from `labelField`, `searchField` retired** (cmd_552): the
  generated `search{Entity}Options` getter's cross-relation substring match (e.g. searching
  `booking` also matching on `resource.name`) used to require a separate
  `x-relationship.searchField` declaration, independent of the `labelField` that actually
  renders on screen — nothing stopped the two from drifting apart. `searchField` is removed;
  `derive_searchable_relation_fields()` (`helpers/schema_helpers.py`) now derives the same
  `{relation, field}` list from `labelField` itself, sharing its origin with cmd_548's CSV-import
  full-match (`build_label_expression`), so the searched field and the displayed field can never
  disagree. Only string-typed, non-dotted `labelField` elements qualify — enum (translated
  on-screen label vs. untranslated stored value, same trap as cmd_493), date/time, number, and
  CUID-pattern id fields are excluded, and a composite `labelField` is evaluated per element.
  `validate.py` now rejects any schema that still declares `searchField` by name. See
  `docs/knowledge/schema-yaml-configuration.md` §5 ("`labelField` is also the autocomplete
  search source").
- **CSV import for composite/dotted labelField FK columns** (cmd_548): a FK relation whose
  display label is composite (`[product.name, location.name]`) or a single dotted path used to be
  export-only — there was no single scalar to resolve a CSV cell back to, so the column landed in
  `UNIMPORTABLE_COLUMN`. It is now resolved by matching the CSV cell against the full rendered
  label text, via a lookup map built once per import (not per row) from the same label-building
  helper the export getter already uses, so export and import can never disagree on what a label
  looks like. Ambiguous labels (two rows sharing the same rendered text) are rejected at row
  granularity (`MULTI_MATCH`, naming the column/value/match-count), not for the whole CSV. See
  `docs/knowledge/csv-import-composite-labelfield.md`.
- **`x-self-only`: permission-independent per-user data isolation, Stage 1** (cmd_536): a new
  entity-level schema flag for data that must be visible/editable only by its own creator as a
  fixed invariant — no permission grant (including `general.read`) can widen it, unlike the
  existing `creator` permission scope which is just a configurable option. Every affected
  generated code path (`getters.ts`, `search_helpers.ts`, `actions.ts`, `api_bulk_route.ts`,
  `api_detail_route.ts`, `service.ts`, CSV import/export, FK-candidate search) drops the
  `general.*` escape and checks `creator_id === actorId` unconditionally; a non-owner's row reads
  as `404 Not Found`. `x-self-only: { admin_bypass: true }` lets a privileged (`Administrator`)
  role read across all rows, but only with an audit row written for the access — the write and the
  bypass are inseparable (fail-closed: if the audit write fails, the bypass is denied too).
  `validate.py` rejects a self-only entity whose backing Prisma model lacks `creator_id`, and
  rejects `creator_id` appearing in `x-import-key`. The account **Settings** page (`setting`) now
  uses this mechanism (`admin_bypass: true`) — other users' settings are no longer reachable
  through any permission grant, while other entities' references to `user` (mentions, comment
  authorship, approver pickers, etc.) are unaffected. A new `personal_note` sample entity ships as
  the generator's own worked example and regression fixture. See
  `docs/knowledge/self-only-entity.md`. Row-Level Security (Stage 2) is not implemented — the
  current dev/test DB role is a superuser and bypasses RLS regardless, so it requires a dedicated
  non-superuser DB role as a prerequisite (an operations task, out of scope here).
- **Post-login redirect-back with open-redirect protection** (cmd_525): unauthenticated
  page requests were already redirected to `/login` by `proxy.ts` before this change, but
  always landed on `/` after signing in, losing the user's original destination. `proxy.ts`
  now carries the originally-requested path via `?redirect=`, and `app/[locale]/login/page.tsx`
  navigates there after a successful sign-in (credentials or Google). The new
  `lib/auth/safe-redirect.ts` (`safeRedirectPath()`) validates the param is a same-origin,
  path-absolute value before use — off-site, protocol-relative, and backslash-trick values
  are rejected and fall back to `/`. API routes are unaffected (still return JSON `401`/`404`);
  the public-path exclusion list (`/login`, `/register`, `/docs`, `/legal`, static assets) is
  unchanged and was re-verified to produce no redirect loop. See
  `docs/knowledge/unauthenticated-page-redirect.md`.
- **`@mention` server-side support** (cmd_522, server side of a two-part feature —
  client-side `MentionInput`/`MentionText` UI ships separately): a new schema-global
  `searchMentionUserOptions()` server action (`lib/mention/search.ts`) returns org-scoped
  candidates (via the same organization-membership relation as `getAssociatedOrganizations()`,
  since `user` has no `organization_id` FK) with Option B graceful degradation on a `user`
  read-permission denial. `encodeMentions()` is retired from the comment save path — the
  picker now inserts `@[user_id:<id>]` markers directly, so `add/updateXxxComment()` store the
  raw client text (the function itself is kept, deprecated, for backward compatibility and unit
  tests). New `'mentioned_in_comment'` notification fires on newly-mentioned users (self-mentions
  excluded; edits notify only newly-added mentions, diffed against the prior message). Detail
  getters add a `canViewUserProfile` flag (viewer's `user` read permission) for the display layer
  to decide whether a mentioned name links to their profile. See
  `docs/knowledge/mention-system.md`.
- **`@mention` client UI** (cmd_522c, client side of the two-part feature above): new
  always-present `MentionInput`/`MentionText` components (`components/_standard/`) — an
  `@`-triggered candidate picker inserting `@[user_id:<id>]` markers, and a renderer that turns
  them into profile links or plain chips depending on the viewer's `canViewUserProfile`.
  `MentionInput` wires into any entity's own `x-mention: true` field on its edit form
  (`mention_fields`); `MentionText` wires into the comment display when `comment_has_mention`,
  via a new `renderMessage` render-prop on `CommentListWrapper`. Fixed a latent conflict this
  exposed: the shared comment getter was already decoding `@[user_id:<id>]` to a plain name
  server-side (pre-dating cmd_522), which left no id for `MentionText` to link — decoding moved to
  the REST API route only (keeping its JSON contract unchanged), while the page/FormView path now
  gets the raw text plus a `mentionUserContext` id→name map. Also fixed: `context.py` (the
  `types.ts.jinja2`-only context builder) never normalized either x-bridge form before detecting
  one-to-one relations, so bridge-based comment threads were invisible to it — now mirrors
  `build_context.py`'s normalization. See `docs/knowledge/mention-system.md`.
- **`@mention` comment-compose picker wiring** (cmd_538): the "write a comment"/edit-comment
  textareas inside `CommentListWrapper` now use `MentionInput` — typing `@` opens real candidate
  suggestions — instead of a plain `TextField`, completing the client-UI scope cmd_522c explicitly
  deferred. `form_upsert.tsx.jinja2` now passes `searchMentionUserOptions` down and threads
  `canViewUserProfile`/`mentionUserContext` to the edit page (previously wired only for the
  read-only `form_view.tsx.jinja2` path). See `docs/knowledge/mention-system.md`.
- **Generated permission-denial and cross-org isolation API tests** (cmd_520 batch A): every
  generated `cypress/e2e/api/<entity>.cy.ts` now includes PUT/DELETE/export/import
  permission-denial tests (7.3–7.6, gated on `can_edit`/`can_delete`/`can_export`/
  `import_eligible`) and, for organization-scoped entities, cross-organization isolation tests
  (G3.1–G3.3: foreign-org CREATE rejected, foreign-org GET/PUT return 404). Adds the
  `db:createCrossOrgScenario` test-fixture task. Adds a one-line coverage comment to every
  generated spec recording which of these tests were actually generated. See
  `docs/knowledge/permission-e2e-test-design.md`.
- **Graceful degradation for foreign-key read-permission gaps**: a role that
  can create/edit an entity but lacks read on one of its FK targets (e.g.
  can manage `approval_flow` but not `role`) previously crashed the create
  and edit pages entirely (`search{Entity}Options()` threw inside the
  page's data-fetching `Promise.all`). The affected field now renders
  disabled instead — read-only for a required FK (which also blocks `/new`
  entirely with an explanatory message, since there's no way to populate
  it), clearable for an optional FK. A required FK omitted from an update
  because of this now falls back to the record's existing value rather
  than failing validation. Template-layer change only, no Prisma schema
  change — regenerate to pick it up, no migration needed. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.
- **Terms of Service / Privacy Policy pages** (`/[locale]/legal/terms`,
  `/[locale]/legal/privacy`), linked from the registration page. Content is
  plain Markdown, one file per document/locale under `content/legal/`,
  resolved independently of the site's UI locale via a `?lang=` query
  parameter — adding a new document language is adding two Markdown files,
  no code change. See `docs/knowledge/legal-documents.md`. Both documents
  are explicitly labeled templates requiring legal review and
  deployment-specific `[PLACEHOLDER]` values before real use.

### Fixed
- **Mention-collection loops read the wrong field off the comment relation**
  (cmd_532): `getters.ts.jinja2` and `api_detail_route.ts.jinja2` read
  `c.creator_id` in both places that collect comment authors for
  `mentionUserContext`, but the comment type only ever declares
  `creator?: { id, name, image }` — a TypeScript compile error on any
  schema whose `comment_has_mention` branch actually renders (this repo's
  own schema never does, which is why the mandatory gate never caught
  it). Both loops now read `c.creator?.id`, matching the type; verified
  safe because `build_context.py` unconditionally includes the `creator`
  relation on every comment fetch that can reach these loops. See
  `docs/knowledge/mention-system.md`.
- **`searchMentionUserOptions()`'s permission-denied flag never reached the client** (cmd_538):
  the function returned an array with an ad-hoc `permissionDenied` property
  (`Object.assign([], { permissionDenied: true })`). Next.js Server Actions serialize return
  values through the RSC "flight" protocol, which — like `JSON.stringify` — only preserves an
  array's indexed elements, so the flag was silently dropped in transit and the picker's
  "suggestions unavailable" message never rendered even though the server correctly computed the
  denial. A component-level unit test couldn't catch this, since it calls the function in-process
  with no serialization boundary to cross. Contract changed to a plain
  `{ options, permissionDenied }` object. The identical pattern in `getters.ts.jinja2`'s
  `searchXxxOptions()` (cmd_516) is presumed to share this bug and was **not** fixed here —
  flagged for a follow-up cmd. Also fixed: `generators_test.py`'s `comment_has_mention`
  test-generation gate missed the commentable one-to-one bridge form, so any entity using that
  (recommended) pattern silently got zero generated mention-UI test coverage; and `lib/prisma.ts`'s
  dynamic `import('@prisma/adapter-pg')` — which made client init depend on a top-level `await` —
  broke any Cypress Node task that transitively imports it, since Cypress's esbuild CJS bundling
  rejects top-level await outright. Switched to a static import (already the established pattern in
  `cypress/support/db-helpers.ts`). See `docs/knowledge/mention-system.md`.
- **Multi-stage approval chains never notified the next approver when their
  turn arrived** (cmd_541): a `preceded_by` chain creates every flow's
  `approval_request` up front, and every flow's approver role is notified
  once at that point — but a follow-on flow isn't actually actionable until
  its preceding flow(s) are approved, and nothing told those approvers when
  that moment came; they only found out by checking back themselves.
  `approveApprovalRequest()` (both independent implementations — the server
  action and the REST route, per cmd_479) now sends a new
  `approval_order_reached` notification, distinct from the creation-time
  one, to any follow-on flow's approvers once its ordering constraint is
  satisfied. See `docs/knowledge/notification-triggers.md` "Approval
  order-reached notification (cmd_541)".

### Security
- **Enforce MFA on the Google OAuth sign-in path** (cmd_527) — previously,
  `mfa_enabled` was only checked inside `CredentialsProvider.authorize()`,
  so an SSO-provisioned user (`password === null`) with MFA enabled could
  sign in via Google and reach a fully authenticated session without ever
  being asked for a TOTP or recovery code. `auth.ts`'s `jwt()` callback now
  sets `mfa_pending` on any non-credentials sign-in for an `mfa_enabled`
  user; `proxy.ts` redirects every protected route to a new
  `/mfa-challenge` page until it clears. A new `user.mfa_token_version`
  column closes a related session-persistence gap (enabling MFA didn't
  previously revoke an already-active JWT). See
  `docs/knowledge/authentication.md` "MFA on the OAuth path".
- **Second, independent gate on the test-only mock Google OAuth provider**
  (cmd_528) — `MOCK_GOOGLE_OAUTH_TEST=true` alone previously let anyone who
  knows a user's email sign in as them with no password/MFA check, if the
  flag ever leaked into a real deploy's env vars. Registering the mock
  provider now additionally requires a filesystem sentinel file that only
  the e2e test harness writes (`scripts/write-mock-oauth-sentinel.js`),
  never any real build/deploy pipeline; fails closed (throws at startup) if
  the flag is set without it. See `docs/knowledge/authentication.md`
  "MFA on the OAuth path" → "Testing without real Google credentials".

### Fixed
- **CSV import dotted-FK org filter gap** (cmd_521, security): a dotted `x-import-key` lookup
  (e.g. `role.name`) on an organization-scoped entity's CSV import route was not itself
  organization-filtered — a same-named row owned by a different organization could resolve and
  get linked to the importing actor's record. The dotted-FK lookup is now org-filtered whenever
  its *target* entity has `organization_id`, independently of the parent entity's own scoping;
  system-global lookup targets (e.g. `role`, no `organization_id`) are correctly left unfiltered.
  Covers both CREATE and UPDATE (shared resolution path); export was already correctly scoped.
  Template-layer change only, no Prisma schema change — regenerate to pick it up, no migration
  needed. See `docs/knowledge/csv-import-dotted-fk-org-filter.md`.
- **CSV import silently dropped screen-editable FK columns not declared in `x-import-key`**
  (cmd_530): an FK relation editable on screen (e.g. `approval_flow.requestor_role`) but absent
  from `x-import-key` had no CSV-import write path at all — the route answered `200 succeeded`
  while discarding the column, on both CREATE and UPDATE. Separately, even a *declared* dotted
  `x-import-key` FK was never rewritten on UPDATE (only merged into CREATE data via `keyWhere`).
  `import_fk_specs` now covers every screen-editable FK relation with a simple (non-composite)
  labelField — resolved via the same lookup-by-label mechanism as a dotted key, written to both
  CREATE and UPDATE. A required FK newly made resolvable this way can also flip
  `import_can_create` from infeasible to feasible for entities like `approval_flow` whose
  required FK wasn't previously part of the key. Exported FK columns that still have no write
  path (composite labelField, or read-only) now reject the import with a new
  `UNIMPORTABLE_COLUMN` error instead of silently succeeding. Template + generator-context
  change only, no Prisma schema change. A KEY-field null→value transition still creates a
  phantom duplicate row rather than updating in place — a separate, deeper natural-key-matching
  limitation, deliberately left unfixed; see the doc's "Known gap" section. See
  `docs/knowledge/csv-import-non-key-fk-write-path.md`.

### Internal
- **Dependabot `target-branch: develop` never took effect** (cmd_531): Dependabot always reads
  `.github/dependabot.yml` from the default branch, not `develop`, so `develop`'s copy of the
  setting was inert; ported to `main`'s copy (PR #248). See
  `docs/knowledge/dependabot-config-read-from-default-branch.md`.
- **MUI major-update PRs grouped into one; missing Dependabot labels created** (cmd_537): added
  an `npm-mui-major` group to `.github/dependabot.yml` (PR #256, the copy on `main` that
  Dependabot reads) so major-version bumps across the whole `@mui/*` scope land as one PR
  instead of one per package. Also created the `dependencies`/`npm`/`python`/`github-actions`
  repo labels that Dependabot's config referenced but that never existed, so future PRs stop
  reporting a missing-label warning.
- **fast-uri HIGH CVE (GHSA-7p8r-x3mc-p8w7) blocking the Dependency Audit gate** (cmd_542):
  transitive via `prisma` → `@prisma/dev` → `@prisma/streams-local` → `ajv@8.20.0` →
  `fast-uri@3.1.4`; the existing `overrides.fast-uri` pin (`^3.1.4`) had itself frozen the
  lockfile on the last vulnerable patch. Bumped the override floor to `^3.1.5` (still within
  ajv's own `^3.0.1` requirement, so no forced major bump). Also closed the 6 moderate
  advisories reported alongside it with narrow, non-breaking overrides: `undici` scoped to the
  `@vercel/blob` subtree only (`^6.28.0`, leaving `jsdom`'s separate `undici@8.9.0` untouched)
  and a global `uuid` bump (`^11.1.1`) for the `gaxios`/`teeny-request` chain under
  `@google-cloud/storage`, verified those two only call the stable `uuid.v4()` export.
  Deliberately did not use `npm audit fix --force`, which pulls in a `@google-cloud/storage`
  downgrade. Verified with a clean `rm -rf node_modules && npm ci` (exit 0) and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities).
- **`x-approval.set_fields` docs contradicted the implementation** (cmd_544): `docs/knowledge/appendix/approval-flow.md`
  §16.9 showed `on_approved.set_fields` as a list-of-`{field, value}` entries, contradicting
  §16.11's mapping form and the only shape `_resolve_set_fields()` (`code_generator/generate.py:289`)
  accepts (it iterates `raw.items()`). A schema author following §16.9 as written hit an
  uninformative `AttributeError` deep inside `generate()`. Fixed the doc example to mapping form
  and added `validate_schema()` Section 10 (`code_generator/validate.py`) to reject a non-mapping
  `set_fields` before generation runs, naming the entity, the offending field key(s), and the
  correct form.
- **`npm run lint` now enforces a warning ceiling** (`eslint --max-warnings 20`, follow-up to
  cmd_529): a prior triage found 216 unused-vars/expressions warnings had silently accumulated
  behind a config gap, one of which was a genuine dead branch — a ceiling that only ratchets down
  (never silently raised) stops that from recurring unnoticed. Seeded 5 warnings above the
  measured `develop`-tip count (15) rather than an exact match, so one incidental warning doesn't
  turn an unrelated PR red. See `docs/knowledge/lint-warning-ceiling-ratchet.md`.

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
- **nativeEnum member names normalized to lowercase snake_case (cmd_493)** —
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
  under `NODE_ENV=production` (cmd_504)** — `scripts/seed-tenant.ts`
  previously seeded the bootstrap admin as `admin@example.com` /
  `password123` with a fixed `api_key` literal unconditionally; since
  app-generator is a public repo, any production deployment provisioned
  without a separate manual rotation shipped with a publicly known admin
  login. Every production-equivalent entry point (`vercel-build`,
  `build:full`, GCP's `gcp-seed.sh`) now fails fast unless both env vars are
  set, and always mints a fresh random `api_key` instead of the literal.
  `test`/`development` are unaffected — the fixed defaults are unchanged, so
  existing Cypress/vitest fixtures pinned to them keep working. See
  [docs/knowledge/seed-tenant-credential-hardening.md](docs/knowledge/seed-tenant-credential-hardening.md)
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
