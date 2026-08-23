# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [Unreleased]

### Removed
- **`scripts/seed.ts` (`npm run db:seed`)** — unused ITS (issue-tracking-system)
  sample-data script. Not referenced by any npm script, prisma seed hook, or
  CI workflow; its only mention in the repo was a stale line in
  `docs/knowledge/troubleshooting.md`. No replacement; if a consumer project
  had a local, unrelated `npm run db:seed` invocation depending on this file
  existing, that invocation now fails.

### Changed
- **`scripts/seed-tenant.ts` renamed to `scripts/seed-baseline.ts`
  (`npm run db:seed-tenant` → `npm run db:seed-baseline`), and its
  neighboring credential-hardening files renamed to match**
  (`scripts/seed-tenant-credentials.ts` → `scripts/seed-baseline-credentials.ts`,
  `scripts/seed-tenant-credentials.test.ts` → `scripts/seed-baseline-credentials.test.ts`,
  `docs/knowledge/seed-tenant-credential-hardening.md` →
  `docs/knowledge/seed-baseline-credential-hardening.md`). The old name
  described a "tenant" concept this script has nothing to do with; the new
  name matches its actual job (seeding the baseline admin user/roles/
  permissions every environment needs). `seed.ts` was deliberately **not**
  reused as the new name (despite being freed up by the removal above) —
  `cy.task('db:seed')`, a same-spelled but unrelated Cypress test-database
  task backed by `cypress/support/db-helpers.ts`, would otherwise collide in
  meaning with `npm run db:seed`. No backward-compatible alias is provided
  (pre-customer, no shipped installs to preserve compatibility for).
  **Consumer impact**: any consumer project or script invoking
  `npm run db:seed-tenant` directly, or a `Bash(npm run db:seed-tenant)`
  permission entry in `.claude/settings.json`, must switch to
  `db:seed-baseline`.
- **Generated apps now default to blocking search-engine indexing.** Generated
  apps are primarily internal tools, and a Vercel production deployment (unlike
  a preview deployment) gets no automatic crawler protection. `app/layout.tsx`
  now sets `<meta name="robots" content="noindex,...">` unless
  `lib/site-config.ts`'s `seo.noindex` is explicitly set to `false` — and
  because the default flipped, an app whose `seo` block (or just `noindex`
  within it) is missing entirely is *also* noindexed, not indexed. See
  `docs/knowledge/noindex-default-and-branding-env-vars.md` for the mechanism,
  why `robots.txt` `Disallow` was rejected, and consumer-impact notes.

### Added
- **`x-relationship: { target: attachment, type: direct }`** — a new field
  declaration for a single-file FK (a profile picture, a signed contract):
  the entity holds its own `{field}_id` pointing at exactly one `attachment`
  row, nullable or required, rendered via a new `SingleAttachmentUpload`
  form widget (create/edit) and `SingleAttachmentDisplay` (view). Unlike the
  existing `attachable_id` bridge (multiple files) and the one-to-one
  selector pattern (a target with its own pages), `attachment` here has no
  list/view/new/edit pages of its own. `attachment.attachable_id` is now
  nullable (`onDelete: SetNull`) to allow this — a direct-attachment FK
  creates an attachment row with no bridge owner at all. See
  `docs/knowledge/schema-yaml-configuration.md` (Direct Attachment FK).
- **`x-uri-kind: file`** — a third `format: uri` field kind alongside
  `image` and `link`: like `image`, the field still uploads through
  `/api/upload` and stores a plain URL string, but displays as a download
  link/icon instead of an `<img>` once set (for a non-image uploaded file,
  e.g. a URL-stored document). Shares the same `SingleAttachmentUpload` /
  `SingleAttachmentDisplay` components as the direct-attachment FK above.
- **`NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_COPYRIGHT`** — optional env vars
  in `lib/site-config.ts` for overriding the app title and footer copyright
  text without touching the file. Both are inlined at build time (Vercel
  needs a rebuild, not just an env var edit, to pick up a change). See
  `docs/knowledge/noindex-default-and-branding-env-vars.md`.

### Fixed
- **`lib/attachment/direct_actions.ts` (the direct-attachment FK server action) was
  emitted unconditionally, breaking `tsc`/`next build` for every consumer regardless
  of whether they used the feature.** The file always creates a standalone
  `attachment` row with `attachable_id: null`, which only type-checks when
  `attachment.attachable_id` is nullable in `prisma/schema.prisma` — a manual
  Prisma-alignment prerequisite this repo's own root `prisma/schema.prisma` already
  has, but that no other project's `prisma/schema.prisma` had ever been asked to
  apply, since none of them declare a `type: direct` field. Because `next build`'s
  TypeScript check type-checks every `.ts` file under `lib/` regardless of whether
  anything imports it, the file broke `tsc` for a project with zero `type: direct`
  fields the moment it picked up a recent generator update, with no schema change of
  its own required to trigger it. `generate.py` now emits
  `lib/attachment/direct_actions.ts` only when at least one entity actually declares
  `x-relationship: {target: attachment, type: direct}`, and separately validates the
  `attachable_id`-nullable prerequisite (with an actionable error message) whenever
  an entity does use the feature, instead of leaving it to surface later as a `tsc`
  error deep inside a generated file. See `docs/knowledge/schema-yaml-configuration.md`
  ("Direct Attachment FK").
- **`x-uri-kind: link` fields were silently absent from the create/edit
  form.** A `format: uri` field declared `x-uri-kind: link` was categorized
  correctly by the generator's field-typing logic, and its read-only display
  (view page, list, DataGrid) already rendered as a clickable external link,
  but no input was ever rendered for it in the create/edit form — the field
  could never be set through the UI, and on every edit of an existing
  record the missing form value let the update path silently overwrite
  (erase) any existing value. Also fixed the same field's read-only display
  inside the edit form (when marked `x-readonly`) and the view page: both
  rendered an image widget instead of a link. See
  `docs/knowledge/schema-yaml-configuration.md` (`x-uri-kind`) and
  `docs/knowledge/readonly-field-form-rendering.md`.
- **The list page's DataGrid never actually rendered an `x-uri-kind: link`
  field as a link.** Contrary to the previous entry above, "list, DataGrid"
  was not already correct: the list-page column config never carried a
  `uriKind` attribute at all (only a parent-embedded `BridgeGrid` did), so a
  link-kind field listed in `x-display.table` rendered as a plain string on
  the list page. The list page now passes the same `uriKind: 'link'`
  attribute a `BridgeGrid` already did, so both read-only grids agree. An
  `x-uri-kind: image` field is unaffected by this fix and still never draws
  an image inside any DataGrid cell — list page, `BridgeGrid`, or an inline
  editable child DataGrid — by design; only the single-record view page
  shows an image preview. See `docs/knowledge/schema-yaml-configuration.md`
  (`x-uri-kind`).
- **The `x-scheduled-task` mechanism's generated route only ever exported
  `POST`, but Vercel Cron always invokes with `GET`** — any declared
  schedule would 405 on every real Vercel Cron invocation and silently
  never run (no exception, no red gate). The route now exports both `GET`
  and `POST`.
- **`vercel.json`'s `crons` array is now written automatically by
  `generate.py`** from each entity's `x-scheduled-task` declaration, instead
  of the previous "copy this into `prj/vercel.json` by hand" convention —
  which was itself unsafe: `npm run prj:sync` would copy a hand-placed
  `prj/vercel.json` back over the generator's own file verbatim on every
  sync. `prj_sync.py` now skips `vercel.json` entirely. Only the `crons` key
  is generator-owned; `framework`/`buildCommand`/`regions` and any other
  hand-added key are preserved untouched.
- **`SCHEDULED_TASK_ACTOR_ID`, an environment variable a human had to set by
  hand, is replaced by a fixed-email lookup** (`lib/scheduled-tasks/
  system-actor.ts`) resolved against a system-actor account `scripts/
  seed-tenant.ts` now seeds unconditionally. The env var design returned
  HTTP 500 on every single scheduled-task invocation until someone
  remembered to set it, with nothing surfacing the omission before the
  first scheduled run actually happened; the account seeded by
  `db:seed-tenant` is already guaranteed to exist before that can occur, on
  both the Vercel and GCP deploy paths.
- `validate.py` now rejects a schema declaring more than 100
  `x-scheduled-task` entities (Vercel's per-project cron-job limit, all
  plans) at generate time, instead of letting `vercel.json` reach Vercel
  with an unsupported count.
- **`scripts/vercel-env.sh` documented `NEXT_PUBLIC_APP_TITLE`/
  `NEXT_PUBLIC_APP_COPYRIGHT` but never actually injected either one into
  Vercel** — `vercel_env_inject` only ever called `inject_var` for
  `CRON_SECRET` and the other operational vars, silently leaving the two
  branding vars unset on every Vercel deploy regardless of what a consumer
  put in `.env.production.local`. Both are now injected the same way,
  alongside a note that (like all `NEXT_PUBLIC_` vars) a value change only
  takes effect on the next build. `.env.vercel.production.local.example`
  gained the matching entries. `docs/knowledge/scheduled-task-operations.md`
  gained a correction: an unset `CRON_SECRET` only blocks Vercel Cron's own
  request, it does not gate manual invocation — any authenticated user can
  call the route regardless of `CRON_SECRET`, which the doc previously did
  not call out — plus the GCP-side placement for all three vars (`CRON_SECRET`
  via Secret Manager mirrors `AUTH_SECRET`; the two branding vars need a
  Docker build-arg path that does not exist yet, since `--set-env-vars` at
  deploy time is too late for a `NEXT_PUBLIC_` var already baked into the
  built client bundle).
- Added `docs/knowledge/scheduled-task-operations.md` — the Vercel and GCP
  operational guide for this mechanism (HTTP method, `CRON_SECRET`, cron
  limits, the system-actor account, and how to tell whether a scheduled
  task is actually firing).

### Internal
- **Fixed a silent output-path collision between the polymorphic attachable-bridge
  actions and a standard per-entity CRUD actions file when `attachment` is
  independently generated** (`generate.py`, `generators.py`). Once a consumer
  schema adds an `x-generate` block to the `attachment` entity itself (needed
  to target it with a standard OTO-selector FK from another entity), two
  independent writers previously both targeted `lib/attachment/actions.ts` —
  the always-on bridge actions template and the standard per-entity actions
  file — and whichever ran last silently clobbered the other's exports,
  breaking `components/_standard/AttachmentSection.tsx`'s import of
  `setAttachmentsForBridge`. The bridge actions output now lives at
  `lib/attachment/bridge_actions.ts`, a path that can never collide.
  Also fixed `attachment_type_ts()` resolving the `attachment` entity via a
  bare `schema['definitions']` lookup, which silently missed the
  `allOf`/`$ref` indirection an independently-generated `attachment` gets
  and fell back to the wrong hardcoded `'number'` type. No consumer
  currently sets `x-generate` on `attachment`, so existing schema output is
  behaviorally unaffected other than the file rename. Verified via lint,
  `test:pytest`, `test:vitest`, all 8 fixture gates, a full `test:e2e:build`
  against an isolated DB, and — for the specific pattern this unblocks (a
  standard OTO FK to an independently-generated `attachment` entity with
  nullable `creator_id`/`updater_id` for bridge-created rows) — an isolated
  scratch entity pair proving `tsc --noEmit` passes end-to-end across the
  whole app, both mandatory Cypress gates (`test:e2e:cy:api` 240/240,
  `test:e2e:cy:ui` 190/190, zero skips), `npm audit`, and `pip-audit`.
- **Fixed the generated `setup<Entity>ApprovalFlow()`/`setup<Entity>OrderedApprovalFlow()`
  test helper never granting its synthetic requestor/approver/no-role test
  users membership in a membership-scoped dependency** (`test_helper.ts.jinja2`).
  For an approval-flow entity whose schema also declares a required/optional
  FK to a membership-scoped entity (e.g. `organization`, detected the same
  way `populate<Entity>Dependencies()` already detects it —
  `x-relationships.users` → `has_user_accounts`), the synthetic users never
  belonged to any such dependency. Their create-form's FK autocomplete for
  that dependency then always returned zero candidates (membership-scoped
  search filters by membership) and the generated approval-flow tests
  (`7.1`/`7.2`/`7.4`/`7.6`/`7.7`/`7.8`) could never submit or view the
  record — reported against a real-world consumer schema (`claim`/
  `endorsement`/`payout`, approval-role-gated `7.2` failing). Both helpers
  now call `populate<Entity>Dependencies()` up front and grant each
  synthetic user membership in every such dependency, mirroring the
  membership grant `populate<Entity>Dependencies()` already gives the
  default test user. Verified against a fresh fixture entity added to the
  app-template regression fortress (`maintenance_ticket`, org-scoped +
  approval-flow): the fortress's `7.1`/`7.2`/`7.4`/`7.6`/`7.7`/`7.8` were
  red before this fix (autocomplete stuck on "No options") and green after,
  both desktop (`21/21`) and API (`45/45`) specs.
- **Fixed a Decimal/date field crashing the write when a user cleared it,
  for any non-nullable-but-not-required column** (`build_context.py`'s
  `_build_form_data_gets()`). An untouched-then-cleared field submits `''`
  via `FormData`; a bare `data.get(prop) as string` cast passed that
  straight to Prisma, which rejected an empty Decimal outright
  (`Failed to parse empty string. Expected decimal String.`) and an empty
  date as `Invalid Date`. This is a product-code defect, not a test defect
  — clearing an optional numeric or date field is an ordinary user action.
  Now falls back to the field's schema default (or `'0'`/`new Date()` when
  no default is declared) for the non-required case; a genuinely required
  field's empty submission is left alone, since it already fails the
  existing `REQUIRED_FIELDS`/`isMissingValue` check in
  `service_validation.ts` cleanly. Separately, DataGrid child rows had **no
  validation of their own at all** — `validateOnAdd`/`validateOnUpdate`
  only ever checked the parent's fields — so a cleared required child date
  reached Prisma raw and threw an uncaught `PrismaClientValidationError`.
  `service.ts.jinja2`'s shared create/update catch block now wraps
  `PrismaClientValidationError`/`PrismaClientKnownRequestError` (beyond the
  existing `P2002` case) as a clean `AppError('VALIDATION', ...)`. See
  `docs/knowledge/decimal-and-date-empty-string-clear-crash.md`.
- **Fixed several generated UI e2e test gaps surfaced by testing a large
  real-world consumer schema end-to-end**, all in `generators_test.py` /
  `label_field.py` / `test_spec.cy.ts.jinja2` / `test_spec_mobile.cy.ts.jinja2`:
  - A row/card lookup keyed on an entity's primary display value used a
    plain substring `cy.contains(text)` — if another visible cell (a
    different column, a dependency row, or another record sharing the same
    primary value) happened to contain that text as a substring, the wrong
    element got clicked and the test failed with a URL/assertion mismatch
    instead of navigating correctly. Broadened the existing exact-match
    helper (previously only applied to self-referential-FK primaries) to
    every such lookup across both the desktop and mobile spec templates.
    Where the primary value isn't reliably unique at all (e.g. an
    `entity_select` primary whose value is shared across many rows), the
    just-created record is now found by grid position instead of by text.
  - A child DataGrid's FK single-select value generator used the target
    entity's own name (`'Test {Entity} A'`) instead of the FK's declared
    `labelField`, so it never matched the dropdown option the UI actually
    renders when `labelField` isn't `'name'`.
  - A non-nullable `format: uri` field was unconditionally skipped when
    generating populate-helper test data, leaving the column unset and
    failing every required-child-entity insert that carried one.
  - A composite `labelField` mixing a database-searchable segment with a
    string-enum segment (e.g. `[claim.claim_no, event_type]`) typed the
    enum's raw value into the autocomplete search box, but the server's
    `searchXxxOptions()` deliberately never searches enum fields (their
    displayed label is translated; their stored value isn't) — the search
    query's own enum token could never match anything, so the autocomplete
    permanently showed no candidates. The Cypress-typed search string now
    excludes non-searchable segments, matching what the server actually
    queries.
  - A bare string-enum `labelField` segment whose value comes from a
    Prisma column default (omitted from the populate helper's own
    `create()` call, since it's not required) computed a fabricated
    placeholder as its expected UI value instead of the schema's declared
    default / first enum member — breaking any assertion or exact-match
    lookup built from it.
  - A DataGrid child date/time cell's "clear a required field" test step
    used `.type('{selectall}{backspace}')`, which Cypress rejects outright
    for a native `datetime-local` input (no `renderEditCell` override
    exists for DataGrid date columns, unlike the top-level form's
    `DateTimeWrapper`). Now uses `.clear()` for that field category.

  Verified end-to-end against a 68-entity real-world consumer schema:
  before the fixes, 14 of that schema's generated UI e2e specs failed;
  after, all 14 pass individually, the schema's remaining 80 specs (desktop
  + mobile) show no new failures, and this repo's own full e2e suite
  (`test:e2e:cy:api` + `test:e2e:cy:ui`, desktop + mobile) stays green.
- **Fixed generated UI e2e tests asserting a placeholder string
  (`'Test {Label} 1'`) instead of the actual enum value for entities whose
  `x-display.table` primary (list-row/card-title) field is a string or
  Prisma nativeEnum column** (category `string_enum` in
  `code_generator/generators_test.py`). The primary-field priority chain in
  `spec_context()` had explicit branches for `entity_select`, integer
  `enum`, and `number`/`decimal` primaries, but none for `string_enum` — it
  fell through to the generic text-field fallback, which generates a value
  the enum column can never actually hold, so every list/DataGrid-row
  lookup keyed on it (`1.2`/`1.3`/`3.x`/`4.x`/`6.x`) failed. A second,
  related gap in the same function's 3.3 ("edits with mixed changes")
  primary-edit-command dispatch used `cy.clearAndFillField` (a plain-text
  command) for the same category instead of
  `cy.clearAutocomplete`/`cy.selectAutocomplete` (how the field is actually
  rendered — matching `gen_fill_command`/`gen_clear_command`'s existing
  fallback for this category everywhere else). Both gaps are fixed by
  reusing the same `cypress_create_value`/`cypress_edit_value` functions the
  generic per-field fill/assert commands already use for `string_enum`, so
  the primary-field assertions match exactly what the form writes and the
  list/card actually renders. Verified end-to-end against a real consumer
  schema (`agent_hierarchy.hierarchy_type`, a Prisma nativeEnum primary):
  before the fix, `agent_hierarchy.cy.ts` failed at `3.3` asserting the
  literal placeholder; after the fix, all 13 desktop + 9 mobile
  `agent_hierarchy` tests pass. Two new unit tests
  (`code_generator/tests/test_e2e_context.py`) cover both gaps with a
  minimal fixture and fail without the fix. No entity in this repo's own
  default schema, nor in the app-template or inventory-app consumer
  schemas checked at the time of this fix, currently has a `string_enum`
  primary field, so this path was previously untested by any existing
  gate.
- **Fixed `lib/_decimal.ts` pulling the Node.js Prisma client into every
  client-side bundle, and corrected a follow-up fix attempt that broke a
  different line in the same file.** The Decimal-display fix below wired
  `formatDecimalDisplay` into four client-side templates
  (`form_view.tsx.jinja2`, `form_upsert.tsx.jinja2`, `column_def.tsx.jinja2`,
  `page_list.tsx.jinja2`) while defining it in `lib/_decimal.ts` alongside
  `deepStringifyDecimals` (which needs `Prisma` imported as a *value* for its
  `instanceof Prisma.Decimal` check) — pulling the whole Prisma client into
  every consumer app's client bundle, surfacing as `TurbopackInternalError`
  on any consumer schema with an actual Decimal field. A first fix attempt
  changed the import to `import type { Prisma }`, which broke
  `deepStringifyDecimals`'s own `instanceof` check in the same file
  (`error TS1361: 'Prisma' cannot be used as a value because it was
  imported using 'import type'`) — the type-only import can't satisfy a
  value-level check that genuinely needs it. The real fix splits the
  module: `formatDecimalDisplay` (Prisma-free) moved to a new
  `lib/_decimal_format.ts`; `deepStringifyDecimals`/`DeepStringifyDecimals`
  stay in `lib/_decimal.ts` with the value import restored. The four client
  templates now import `formatDecimalDisplay` from `_decimal_format.ts`
  directly, never through `_decimal.ts` (a re-export barrel would still
  pull `_decimal.ts`'s own top-level Prisma import into the bundle).
  Verified with a real `next build` (not just `tsc --noEmit`, which cannot
  see this class of client/server boundary defect at all — see
  `docs/knowledge/decimal-client-server-boundary-gate-limitation.md`):
  reproduced the exact reported `TS1361` failure with the broken import
  restored, confirmed the fix builds clean, and confirmed the fix breaks
  again without it. No existing gate (this repo's own default schema has
  zero Decimal fields) exercises this path automatically; the doc above
  records why and gives the manual verification recipe for next time.
- **Fixed two generated-app defects surfaced by UI e2e testing (not caught
  by the mandatory API e2e gate): Decimal fields displaying with dropped
  trailing zeros, and optional one-to-one selector FK autocompletes losing
  every candidate once the user types.** (1) Read-only Decimal display
  (detail-page fields, edit-mode readonly fields, the top-level list page,
  and DataGrid child columns) rendered `Decimal.toString()` verbatim
  (`"1"` instead of the declared-scale `"1.00"`) — none of these four
  display sites padded to `x-decimal-scale`, only the edit-mode input field
  did. Added `formatDecimalDisplay()` (`lib/_decimal.ts`, string-based
  padding — never routes through `Number()`, which would reintroduce the
  float rounding `Decimal` exists to avoid) and wired it into
  `_readonly_display_field()`, `page_list_context()`, and
  `column_def_context()`. (2) A selector one-to-one FK autocomplete (`type:
  one-to-one` in `x-relationship`, e.g. an optional FK to an entity with its
  own list/view/new/edit pages) showed its initial candidate list correctly
  (`getAvailable{Target}sFor{Parent}()`, passed via `initial{Target}s`) but
  returned zero results as soon as the user typed: `page_new.tsx.jinja2` /
  `page_edit.tsx.jinja2` never imported or passed a `search{Target}Options`
  prop for selector one-to-one relation targets (only for regular
  many-to-one FK targets), so `FormUpsert.tsx`'s generated search callback
  (`searchXOptions?.(query, includeIds) ?? []`) always resolved to an empty
  array once the optional-chained call hit an unpassed `undefined` prop.
  Both pages now import and pass it, mirroring the existing many-to-one
  wiring. Neither fix changes behavior for a schema with zero Decimal
  fields / zero selector one-to-one relations — this repo's own
  `code_generator/json_schema.yaml` has neither, so its own e2e suite
  cannot exercise either branch; verified instead via the
  `decimal_gate` / `oto_decimal_gate` / `oto_mandatory_gate` fixture
  pipelines (`build_user_schema.py` → `generate.py` → `prisma generate` →
  `tsc`, all exit 0) and the full `code_generator` pytest suite (1375
  passed, 1 pre-existing unrelated skip). The FK-autocomplete filtering
  root cause was found and fixed within the time budget; a labelField that
  itself resolves to a Decimal column (`build_label_expression()` in
  `code_generator/helpers/label_field.py`) is a narrower, unaddressed edge
  case — noted, not silently dropped.
- **Fixed the generated Stripe integration stubs (`lib/stripe.ts`,
  `app/api/webhooks/stripe/route.ts`) throwing at module top level when a
  required Stripe env var was unset, which failed the production `next
  build` itself (not just the route at request time) in any consumer with
  `x-payment: true` declared.** Next.js evaluates every route module while
  collecting page data during `next build`, regardless of the HTTP methods
  it exports, so importing the `POST`-only checkout route pulled in
  `lib/stripe.ts`'s top-level `throw` — meaning any deploy without
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` configured (a preview
  deploy, for example) failed the build outright. Both checks now defer to
  first use: `lib/stripe.ts` exports its Stripe client lazily behind a
  `Proxy` (constructed on first property access, so import alone never
  throws), and the webhook route's secret check moved from module scope
  into its `POST` handler. Fail-closed behavior is unchanged in
  substance — using either code path without the required key still
  throws immediately with the same message — only the timing moved from
  build/import time to request time. See
  `docs/knowledge/stripe-payment-integration.md` "Lazy construction note".
- **Fixed the Gantt-chart getter not serializing a required Decimal column,
  added a required `chart-decimal-gate-fixture` CI check, and corrected a
  doc section that had documented the resulting workaround as intended
  behavior.** `get{Parent}sForChart` (`chart_getters.ts.jinja2`), generated
  only when `x-display.chart` is declared, assigned a required Decimal
  column straight off the raw Prisma row (`{{ field }}: item.{{ field }},`)
  into a field the generated `{Parent}ForChart` interface types as `string`
  (`chart_context()` in `generators.py` resolves a Decimal column's
  JSON-schema type as `string`, per its `_prisma_decimal_type` marker
  (`schema_deriver.py`) -- but the raw row value is a `Prisma.Decimal`
  instance) -- a `TS2322` at
  build time. A production consumer schema had worked around this by
  marking two Decimal columns nullable (nullable columns are dropped from
  the chart projection entirely by `chart_context()`'s
  `field_name not in required: continue`, so the type mismatch never
  arose), and a doc section had documented that workaround as correct,
  intentional behavior rather than as a generator defect being routed
  around. The getter now stringifies a Decimal column the same way
  `getters.ts`'s `decimal_display_columns` does for an entity's own
  columns (a null-safe `.toString()`), matching every other Decimal
  crossing the Server-to-Client Component boundary. This went undetected
  because no entity in this repo's own default schema combines
  `x-display.chart` with a required Decimal column, so no existing gate
  ever type-checked this getter against one -- `npm run
  test:chart-decimal-gate` closes that gap the same way
  `test:decimal-gate`/`test:oto-decimal-gate` do for their own dark
  branches, and is now a required, unconditional CI job alongside them.
  See `.claude/commands/update-generator.md` Completion gate step 8.
- **Extended the Gantt-chart projection to a required plain Int/Float
  scalar and a required DateTime column other than the chart's own
  start/end pair, and added a required `chart-scalar-gate-fixture` CI
  check.** `chart_context()` (`generators.py`) previously projected onto
  the generated `{Parent}ForChart` interface only a required string
  column, or a required int/number enum with string labels -- a required
  plain Int (or Float, if a future Prisma type addition ever supports it;
  today only Int reaches this branch, since `schema_deriver.py`'s
  `_SCALAR_JSON_TYPE` has no `Float` entry) was silently dropped from the
  projection entirely, with no interface field and no chance of becoming
  the Gantt tooltip -- an undocumented asymmetry with a required string
  column, which was projected. Separately, a required DateTime column
  other than `start_time`/`end_time` was assigned straight off the raw
  Prisma row into a field the generated interface types as `string` -- a
  `Date` instance isn't a string, the same `TS2322` class the previous
  entry fixed for Decimal, just for a different type, and never caught
  because no fixture combined `x-display.chart` with an extra required
  DateTime column. Both are now handled: a plain Int/Float column is
  projected as `number` with no stringification needed (unlike Decimal,
  which round-trips through decimal.js specifically to avoid float
  rounding error -- 2026-08-15's Decimal-as-string ruling), and a
  DateTime column (any `format`: `date-time`, `date`, or `time`) is now
  excluded from the projection entirely, not serialized -- correct
  local-time display needs client-side formatting, out of this fix's
  scope, and `start_time`/`end_time` already carry the chart's time
  information. A required Boolean column is
  now explicitly excluded (not a silent drop -- a bare true/false carries
  little context in a Gantt-row tooltip), and a required column whose
  resolved type isn't one of the above now fails generation loudly rather
  than vanishing from the projection. BigInt needs no handling here
  either: `schema_deriver.py`'s `_SCALAR_JSON_TYPE` has no `BigInt` entry,
  so a BigInt column is already rejected during schema derivation, long
  before it could reach this function. Only the first projected field, in
  the entity's field declaration order, becomes the Gantt tooltip --
  unchanged from before this change, and unaffected by it for the one
  known consumer schema with `x-display.chart` (its own required-string
  tooltip field is still declared first). This went undetected because no
  entity in this repo's own default schema combines `x-display.chart`
  with a required Int/Float or extra required DateTime column, so no
  existing gate ever type-checked these branches -- `npm run
  test:chart-scalar-gate` closes that gap the same way
  `test:chart-decimal-gate` does for its own dark branch, kept as a
  separate fixture (not an extension of `chart_decimal_gate`) to keep
  each fixture's build/type-check independent of the other's scope and
  history, and is now a required, unconditional CI job alongside it. The
  chart configuration section of `docs/knowledge/schema-yaml-configuration.md`
  now documents, per field type, what is projected onto the chart and
  which one becomes the tooltip. See `.claude/commands/update-generator.md`
  Completion gate step 9.
- **Fixed a one-to-one selector's "available options" getter not
  serializing the target entity's Decimal columns, and added a required
  `oto-decimal-gate-fixture` CI check.**
  `getAvailable{Target}sFor{Parent}` (`getters.ts.jinja2`) returned the
  target's raw Prisma rows unconditionally, unlike `search{Parent}Options`
  (`decimal_display_columns` `.toString()` override) and
  `relationship_mapping` (`deepStringifyDecimals` wrap for an embedded
  relation) elsewhere in the same file. A one-to-one selector whose
  target entity carried a Decimal column hit `TS2322` at build time,
  because the raw rows were handed straight to a Client Component prop
  (`initialAvailable{Target}s`, consumed by `page_new.tsx`/
  `page_edit.tsx`) typed against the generated (Decimal-as-string)
  interface. The getter now wraps its return with `deepStringifyDecimals`
  when the target carries a Decimal column at any depth (own column or an
  embedded relation, via the same `_entity_decimal_deep` check
  `relationship_mapping` already uses), matching every other Decimal
  crossing the Server-to-Client Component boundary in this file. This
  went undetected because no entity in this repo's own default schema has
  a one-to-one selector FK at all, so no existing gate ever type-checked
  this getter against a Decimal-bearing target -- `npm run
  test:oto-decimal-gate` closes that gap the same way `test:decimal-gate`/
  `test:oto-mandatory-gate` do for their own dark branches, and is now a
  required, unconditional CI job alongside them. See
  `.claude/commands/update-generator.md` Completion gate step 7.
- **`split_same_target_fk_deps()`'s same-target multi-FK fix (multiple FK fields on one entity
  pointing at the same target, e.g. `claim.insured_party_id` / `claim.insurer_party_id` both
  `-> party`) only rewrote the split model's own `entity_fk_deps`, leaving an unrelated dep's own
  nested `fk_deps` entry pointing at the now-removed bare-target var** (found via a real-world
  schema run: a `claim -> policy -> party` chain, where `policy` independently has its own
  `party_id` FK). `resolve_dependencies()` builds `policy`'s dep object with
  `fk_deps: [{'prop_name': 'party_id', 'dep_var_name': 'party'}]` before the split ever runs;
  once the split replaced the bare `party` dep with `insuredParty`/`insurerParty`, that reference
  pointed at a variable that no longer existed anywhere in `deps`, so `helper_context()`'s
  `_dep_lookup_columns()` still emitted it verbatim — the rendered `cypress/support/<entity>/
  helper.ts` contained `party_id: party.id` with no `const party = ...` declaration anywhere in
  the file (a `ReferenceError` at test-run time, not a compile error, since other deps' `const`
  declarations exist under different names). Also fixed a related ordering bug: the split deps
  were appended to the end of `deps` instead of being inserted at the position the removed bare
  dep occupied, so a dependent dep like `policy` could render *before* the split dep it now
  references. Fixed by repointing any stale nested `fk_deps` reference at the first split dep for
  that target (any one is a real, already-created record, so it satisfies the FK regardless of
  which of the model's own fields the split was keyed on) and inserting the split deps back at
  the original position. Added `TestSplitSameTargetFkDepsIndirectDep` and
  `TestHelperContextIndirectDepNoDanglingReference` to
  `code_generator/tests/test_multi_fk_same_target_var_collision.py`, confirmed to fail against
  the pre-fix code (`party_id: party.id` present, no `const party` declaration) and pass against
  the fix. Removes the workaround trap note added for this same defect just before this fix
  landed (this repo's own default schema has no same-target multi-FK entity, so the trap note
  documented a real, then-still-open gap for consumer schemas) — the defect is now fully closed
  for both the direct split-model case and the indirect other-dep case, so the trap no longer
  applies. Verified: full mandatory gate green (`lint`; `pytest` 1371 passed, 0 skipped;
  `vitest` 473 passed; all four fixture gates; `test:e2e:build`; `check:generated`;
  `test:e2e:cy:api` 240/240; `test:e2e:cy:ui` 190/190; `npm audit` 0 vulnerabilities; `pip-audit`
  0 vulnerabilities).
- **Removed the hardcoded Stripe `apiVersion` literal from the
  `x-payment` write-once `lib/stripe.ts` stub, and added a required
  `payment-gate-fixture` CI check.** The stub used to pin
  `apiVersion: '2025-03-31.basil'`; the installed `stripe` SDK's own
  TypeScript type for that field is a single literal baked into
  whatever SDK version is actually installed, and it changes on every
  SDK bump (including patch bumps within the same `^` range) -- so a
  hardcoded literal there inevitably goes stale and breaks `next build`
  in any consumer that declares `x-payment: true`. The stub now omits
  the field, which the SDK's own source confirms is behaviorally
  identical to pinning the current version (`props.apiVersion ||
  DEFAULT_API_VERSION`), without the stale-literal hazard. This went
  undetected because no entity in this repo's own default schema
  declares `x-payment: true`, so no existing gate ever type-checked the
  stub's generated content -- `npm run test:payment-gate` closes that
  gap by running the `x-payment` fixture through the real
  `build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline, and
  is now a required, unconditional CI job alongside the mention/decimal/
  OTO-mandatory/approval-lockdown gate fixtures. See
  `docs/knowledge/stripe-payment-integration.md`.
- **Added a docs-only Vercel build skip for the three consumer
  projects.** `scripts/vercel-ignore-check.sh` (canonical
  logic) + `vercel-ignore.json` (a tiny stub `ignoreCommand`) in this
  repo; each consumer repo's root carries that same stub content as its
  own real `vercel.json` file (a symlink was tried first and measurably
  broke Vercel's config discovery — see the doc below). `ignoreCommand`
  set inside this repo's own
  `vercel.json` (Root-Directory-scoped, for the three Vercel projects)
  is never read by Vercel — confirmed empirically across many probe
  deployments — so a root-level file is required for this one key
  specifically; `framework`/`buildCommand`/`regions` are unchanged
  here and keep resolving as before. See
  `docs/knowledge/vercel-docs-only-ignore-command.md` for the full
  measured mechanics and why this deviates from a pure single-file
  design.
- **Added `concurrency` and a docs-only `detect-changes` gate to
  app-generator's own `.github/workflows/ci.yml`.**
  `concurrency: {group: ${{ github.workflow }}-${{ github.ref }},
  cancel-in-progress: true}` cancels a superseded run on the same ref — a
  public repo has no billed-minutes savings from this, only shorter queue
  wait. `detect-changes` classifies each push/PR as docs-only or not via
  `git diff` pathspec exclusion and gates only `e2e-tests` (the
  dominant-cost job, ~57-60 min) via `needs:`+`if:` — not
  `paths-ignore:`, so a skip shows up as "Skipped" in PR checks rather
  than the check not existing at all. The other eight generator-specific
  jobs (`lint`, `unit-tests`, `audit`, `audit-full-scope`, `pytest`,
  `mention-gate-fixture`, `decimal-gate-fixture`,
  `oto-mandatory-gate-fixture`) always run, as a safety net against a
  path-judgment mistake. `docs/consumer-commands/**` is excluded from the
  docs-only exemption (checked before, not folded into, the general
  `docs/**` exclusion — git pathspec exclude has no re-include operator):
  it is the canonical source distributed to every consumer's own CI/gate
  definitions, not documentation about this repo, and a PR editing it
  must still run this repo's own suite. `AGENTS.md` and
  `.claude/commands/*.md` are excluded from the exemption for the same
  reason (CLAUDE.md "Gate SoT Rule" — they carry this repo's own gate
  definitions). A missing/unusable base commit (new branch, shallow
  history) runs the full suite (fail-closed), never skips on "unknown."
  `verify-canonical-ci` stays consumer-side only — app-generator
  is the canonical source itself, so there is nothing meaningful for it
  to diff against locally.
- **Added a machine-checked drift gate for the canonical consumer
  `.github/workflows/ci.yml`.** `docs/consumer-commands/ci.yml`
  is distributed to consumers as a plain copy (not a symlink — GitHub
  Actions resolves workflow files, including trigger eligibility, from
  the target repo's own tree before any checkout happens, so a symlink
  risks silently breaking trigger discovery). A copy can only ever be
  claimed to be "verbatim" by whoever distributed it; the first
  distributed copy already wasn't (a step's `name:` field carried an
  appended internal tracking suffix, and several comments were
  reworded). Added a `verify-canonical-ci` job to the canonical body
  itself, so it travels with every future distribution: it checks out
  the consumer's `app-generator` submodule, extracts both this file's
  own body and the submodule's `docs/consumer-commands/ci.yml` body
  (from the `name: CI` line onward) and fails the job on any diff. See
  `docs/knowledge/ci-workflow-canonical-source.md` "Drift check" for the
  placement rationale (consumer-side only — a generator-side check would
  need cross-repo tokens for the two private consumers) and the
  full-body-vs-structure-only scope decision.
- **Added opt-in Stripe payment integration to the code generator,
  gated by a new `x-payment` entity-level schema key.** Not a default-schema
  feature and generates no `Plan`/`Product`/`Purchase`-style entity, authz
  layer, or UI — declaring `x-payment: true` on any entity causes
  `generate.py` to write three write-once stub files the first time
  `generate-code` runs: `lib/stripe.ts` (Stripe SDK init, fails closed if
  `STRIPE_SECRET_KEY` is unset), `app/api/payment/checkout/route.ts`
  (Checkout Session creation), and `app/api/webhooks/stripe/route.ts`
  (webhook receiver, signature-verified via `req.text()` →
  `constructEvent`, fails closed if `STRIPE_WEBHOOK_SECRET` is unset). Same
  write-once convention as `lib/<parent>/invalidate_handler.ts` —
  a consumer's edits to these files survive regeneration. Scope is
  one-time purchases only (Checkout Session `mode: payment`); subscription
  lifecycle handling is left for a consumer to add. `.env.example` gained
  `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET`
  placeholders (no values). Added `stripe` (`^22.5.0`) as a runtime
  dependency. See `docs/knowledge/stripe-payment-integration.md`.
- **Added `scripts/vercel-{setup,deploy,env,teardown}.sh` and
  `.env.vercel.production.local.example` as the canonical source of the
  Vercel deployment tooling used by generated consumer apps.**
  These five files were previously duplicated independently across three
  consumer repos (app-template, inventory-app, insurance-app); they were
  found byte-identical (scripts) or near-identical (env template, missing
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` in app-template only — a real
  gap, now fixed via the shared copy) and are promoted here so consumers
  can reference a single source instead of three independently drifting
  copies. See `docs/knowledge/vercel-deploy-scripts-canonical-source.md`.
- **Added Prisma `Decimal` support to the code generator, mapped to JSON schema type
  `"string"` — never `"number"` (a deliberate product decision: a JS-float mapping risks silent
  rounding error on read/write/CSV round-trip; the Prisma schema previously had no supported way
  to declare a `Decimal` column at all — `schema_deriver.py` raised `SchemaDivergenceError` for
  any entity that tried). Six layers: (1) `schema_deriver.py`'s `_SCALAR_JSON_TYPE` maps
  `Decimal` to `string` and auto-reflects `@db.Decimal(p, s)`'s scale as `x-decimal-scale`; (2)
  `form_validation.ts`/`service_validation.ts` gained a `DECIMAL_FIELDS` numeric-format check
  (client + server); (3) the form renders a numeric-styled text input
  (`AppFieldText`/`inputMode="decimal"`), not the JS-`number`-backed `NumberField`; (4) CSV
  import/export never calls `Number()` on a Decimal cell (new `'decimal'` `ts_type`, format-
  validated but kept as a string) and `getters.ts`'s Decimal columns are explicitly
  `.toString()`'d before crossing the Server-to-Client Component boundary (a raw Prisma `Decimal`
  instance there would otherwise throw — this was a hard crash, not just a display nicety); (5)
  DataGrid-child test-row seeding gained a Decimal branch; (6) migrations use Prisma's own
  `@db.Decimal(p, s)` support directly, no generator-specific step needed. Also fixed two
  latent bugs surfaced while wiring this in: (a) the search-token/autocomplete-filter helper
  previously swept any `type: "string"` field into a Prisma `contains` filter, which a Decimal
  column doesn't support — excluded via the new internal marker; (b) `form_validation.ts.jinja2`'s
  `DECIMAL_FIELDS = [] as const` pattern, when empty (true for every entity without a Decimal
  field), typed the `for...of` loop variable as `never` and failed to compile — fixed with an
  explicit array type instead of `as const`. Regression coverage: `code_generator/tests/
  test_schema_deriver.py` (pytest, confirmed to raise `SchemaDivergenceError` against the pre-fix
  generator and pass against the fixed one) plus a new permanent fixture gate,
  `test:decimal-gate` (`code_generator/tests/fixtures/decimal_gate/`, mirroring the existing
  `test:mention-gate` pattern — wired into the Completion gate and CI, since this repo's own
  `json_schema.yaml` has no Decimal field and would otherwise never compile any of these
  branches). Verified against a real Postgres round-trip (create, read, `.toString()`) with
  values chosen to defeat JS-float precision, and against the CSV import format-check logic
  directly. `Json` is out of scope for this change (existing usage is internal-only, hand-written,
  never exposed through the `fields:`-driven schema pipeline this change touches). Checked
  `app-template` (proj_c, zero `Decimal` usage) and `app-template-4`/`app-template-5`
  (proj_g/proj_h): neither declares an actual Prisma `Decimal` column today, but both carry
  code comments documenting that they chose `Int`-cents specifically because the generator
  didn't support `Decimal` — direct evidence of the gap this change closes, though migrating
  either consumer to `Decimal` is a separate, unstarted decision.
- **Fixed two generator defects confirmed real by deviation-injection reproduction:**
  - A required one-to-one selector FK (`x-relationship: {type: one-to-one, ...}` on a field listed in
    the entity's `required`) made the generated `page_new.tsx` unbuildable. `build_context.py`'s
    `required_relation_fields` (the Option B permission-guard list from an earlier change) merged entries from
    `parent_rels_raw` and `selector_oto_rels` without distinguishing them, and
    `page_new.tsx.jinja2` re-derived a single `initial{Target}s` variable name for both — correct for
    `parent_rels_raw` entries (matching the `Promise.all` destructure) but wrong for `selector_oto_rels`
    entries, which actually destructure as `initialAvailable{Target}s`. The guard block referenced an
    identifier `Promise.all` never declared (`Cannot find name 'initialAppForms'`-style TypeScript
    build failure), while the optional (nullable) form of the same relationship was unaffected. Fixed
    by pre-computing each entry's `init_var` in `build_context.py` at the correct naming convention for
    its source list, and having the template reference `f.init_var` directly instead of reconstructing
    the name from `target`. Verified both-sides with a synthetic schema (required vs. optional
    one-to-one selector to the same target): the required side's generated `page_new.tsx` referenced
    the undeclared variable before the fix and the correctly-declared one after, with the optional
    side's generated output byte-identical across both runs.
  - A parent entity with no date/date-time/time field of its own, but with an inline (non-independent)
    datagrid child that has one, generated a `FormUpsert.tsx` calling `dayjs()` (embedded by
    `_new_prop_val()`'s child-row-default logic, part of `child_grid_setup`) without importing `dayjs`
    — the `has_datetime_props` gate for the `dayjs` import in `form_upsert.tsx.jinja2` only checked the
    parent's own date fields plus a `'DateTimeWrapper'` substring fallback over `_rendered_body_text`,
    neither of which sees `child_grid_setup`'s content. Fixed by also checking `'dayjs('` against
    `child_grid_setup` in `generators.py`'s `has_datetime_props` computation. Verified both-sides with a
    synthetic schema (date-free parent, inline child with a `format: date` field): `dayjs` was called
    without an import before the fix and correctly imported after.
  - Both fixes are unit-tested (`code_generator/tests/test_form_upsert.py`,
    `TestRequiredRelationFieldsInitVarPlainFK` / `TestSelectorOTOMandatory`'s new
    `test_required_relation_fields_init_var_uses_available_prefix` / `TestChildGridDatetimePropsGate`),
    confirmed to fail against the pre-fix generator and pass against the fixed one. Checked for live
    impact against `app-template` (proj_c) and `app-template-4`'s (proj_g) actual schemas: neither has
    any `type: one-to-one` selector relationship (only the unrelated `one-to-one_bridge` mechanism), so
    the first defect has zero current exposure in either; the only inline, non-independent child with a
    date field in either schema (`app-template`'s `parent1_child2`) belongs to a parent (`parent1`)
    that already has its own `date-time` field, which already satisfied `has_datetime_props` before this
    fix, so the second defect was also not live-exposed there either — confirmed by direct inspection of
    each consumer's schema, not by regenerating their code.
- **Added a `test:oto-mandatory-gate` fixture gate closing a regression-coverage hole in
  the required-one-to-one-selector fix above.** The `test_form_upsert.py` unit tests added for that fix
  call `build_context.py`'s functions directly; nothing in this repo's own `generate-code`/build (the
  `test:e2e:build` gate), nor in any currently known consumer schema (`app-template`/proj_c,
  `app-template-4`/proj_g, `inventory-app`), has an entity with a required (non-nullable)
  `type: one-to-one` selector FK, so the actual `page_new.tsx.jinja2` template branch the fix touches
  was never compiled by any mandatory gate — "all green" did not mean "this branch works," the same
  gap `test:mention-gate` already closes for an unrelated branch. Follows that same pattern
  (and the `invalidate_handler` write-once-stub precedent): a new, self-contained fixture
  entity pair (`code_generator/tests/fixtures/oto_mandatory/` — `oto_gate_target`, a selector target
  with its own pages, and `oto_gate_item`, whose FK to it is required) run through the real
  `build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline
  (`scripts/check_oto_mandatory_gate_fixture.sh`), wired into `package.json`
  (`npm run test:oto-mandatory-gate`), CI (`.github/workflows/ci.yml`'s new
  `oto-mandatory-gate-fixture` job, no path filter — same unconditional treatment as
  `mention-gate-fixture`), and `.claude/commands/update-generator.md`'s Completion gate (new step 5).
  A new fixture rather than an extension of `mention_gate` — that fixture's own scope is deliberately
  narrow to the unrelated `commentable`/`x-mention` branch (see its `json_schema.yaml`'s design note for
  why folding in an unrelated defect class was rejected). Verified both-sides: run against the
  generator commit immediately before the fix above (`b0d1f298`, detached worktree, `git worktree
  add --detach` — no `git checkout`/`reset`/`stash` on the working branch, per D004), the fixture's
  generated `page_new.tsx` produces the exact `Cannot find name 'initialOtoGateTargets'` `tsc` failure
  the fix corrects; run against the fixed generator, `tsc` exits 0. Real consumer relevance: the
  external repo `menlab-auto` has two required one-to-one selectors (`pre_check.checkup_id` /
  `checkup_result.checkup_id`) and is currently unaffected only because its generator pointer predates
  the defect's introduction — this fixture is what stands between the defect returning and every future
  mandatory gate staying green anyway.
- Re-keyed `lint:prj`'s (`scripts/lint_prj_synced.py`) fail-closed condition from "zero `.ts`/`.tsx` files synced" to "`prj:sync` could not be observed running against a real `../prj`" — a consumer whose `prj/` holds only non-TypeScript content (e.g. schema/SQL/migration files) with no hand-written TS is now a legitimate PASS (with an explicit "measured N files, none .ts/.tsx" message), not a FAIL. The three genuine "could not measure" cases (`prj_sync.py` exiting non-zero, no `../prj` sibling directory, or zero synced files of any kind) still FAIL exactly as before. Verified with three injection scenarios (no `../prj` → FAIL; `../prj` with only non-TS content → PASS; `../prj` with one syntactically-broken `.ts` file → FAIL) and against a real consumer's actual `prj/` content (copied read-only into a scratch directory, the consumer's own working tree never touched): the prior implementation failed closed on that exact content, the fixed implementation passes. Also revised the module docstring, failure/pass messages, and `docs/knowledge/consumer-prj-scoped-lint.md`'s "Fail-closed" section to describe the new measured-vs-unmeasured distinction (the old text's "that is expected to be a temporary state, not a permanent green" framing is removed — a TS-free `prj/` is not temporary, it's a legitimate consumer shape).
- Added `scripts/generated/seed-entities.ts` (auto-generated by `generate-code`, via `seed_entities_context()` in `code_generator/generators.py`) — derives the "independent entity" population of a project's schema (any entity that is a `schema['definitions']` key, has an `id` property directly, is not an x-bridge junction target, and is not an internal-only marker entity such as `approvable`/`commentable`/`attachable`/`notification`). This is consumed by a new development/verification-only script, `scripts/grant-all-permissions.ts` (`npm run db:grant-all-permissions`) — grants the `Administrator` role full CRUD on every independent entity in one step, including any entity a consumer project adds on top of the default schema. `audit_log`/`mfa_recovery_code` are excluded both structurally (never schema-defined entities) and explicitly (`ALWAYS_EXCLUDED` in the script) — verified via a deviation-injection test (`code_generator/tests/test_seed_entities_context.py`) and a live-database check confirming zero write-access permission rows on `audit_log` after running the script. `scripts/seed-tenant.ts` (the production seed) is unchanged — it keeps its existing fixed, least-privilege entity enumeration; see `docs/knowledge/seed-baseline-credential-hardening.md` for the full design and the distinction from the similarly-named Cypress-only `grantAllEntityPermissions()` test helper.
- `scripts/seed-tenant.ts` now also seeds `Creator` and `Assignee` roles (resolved by name in `lib/authz.ts`, no per-user role assignment needed). `Creator` is granted exactly `setting.read` + `setting.update`, so a non-admin user can reach their own `/setting` page via the existing `x-self-only` mechanism; `Assignee` is seeded with no permissions (placeholder for future use). Verified against a live database, including the negative case: a user whose `creator_id` does not equal their own id is correctly denied read/update access to their own settings row.
- Documented (and verified against a live database) a `creator_id` self-reference exception for the `user` entity: every generated `add<Entity>()` sets `creator_id` to the acting user unconditionally, which is wrong for `user` itself (a newly created user could never reach their own `/setting` page, since it filters by `creator_id === the logged-in user's id`). A hand-written `lib/user/service_after_create.ts` hook fixes this — tried first per the generator's existing write-once-stub customization convention, and found sufficient (no new schema flag needed). Not reachable by default (`user.x-generate.new` is `false`); documented in `docs/knowledge/seed-baseline-credential-hardening.md` for any consumer project that enables user creation.
- **Fixed an SSL deprecation warning during `db:seed-tenant`/runtime queries against Neon**:
  `pg-connection-string`'s one-time `deprecatedSslModeWarning` fires whenever a connection string's
  `sslmode` is `prefer`/`require`/`verify-ca` — Neon's connection strings embed `sslmode=require` by
  default. No first-party code sets any SSL option explicitly (repo-wide grep for
  `sslmode|ssl:|rejectUnauthorized|NODE_TLS` in `.ts`/`.js` returns zero hits). Confirmed by direct
  inspection of the installed `pg-connection-string@2.11.0` source, and by a live `pg.Pool.connect()`
  attempt, that `sslmode=require` and `sslmode=verify-full` produce a byte-identical resulting `ssl`
  config today — so this is currently cosmetic, not a live weakness — but the deprecation notice means
  `require`/`prefer`/`verify-ca` will adopt weaker standard libpq semantics once
  `pg-connection-string`/`pg` reach their next major version, while `verify-full` is guaranteed to keep
  today's stricter behavior across that bump. Added `lib/db-url.ts`'s `pinSslModeVerifyFull()`, a pure
  string transform applied in `lib/prisma.ts` and `scripts/seed-tenant.ts` right before constructing the
  `PrismaPg` adapter: rewrites `prefer`/`require`/`verify-ca` to `verify-full`, no-op otherwise (so
  local/CI Postgres URLs, which have no `sslmode` param, are unaffected). `prisma migrate deploy`
  (`vercel-build`) does not go through `pg-connection-string` at all — Prisma's migration engine is a
  separate Rust-based connector — so it was never affected. Not fixed by suppressing the warning
  (`NODE_NO_WARNINGS` or similar): that would hide the future behavior change instead of freezing
  today's safe behavior. Verified live (real `pool.connect()` attempt, no Neon/Vercel connection
  involved): the warning fires for a raw `sslmode=require` DSN and is silent for the same DSN passed
  through `pinSslModeVerifyFull()` first, with an identical connection outcome either way. 7 new unit
  tests in `lib/db-url.test.ts`. Full root-cause writeup:
  `docs/knowledge/pg-connection-string-sslmode-deprecation.md`.
- Added an opt-in Neon serverless driver adapter path to `lib/prisma.ts`, gated by the
  `USE_NEON_ADAPTER` env var (added across two earlier changes). Originally shipped inactive — nothing set this
  var anywhere. `scripts/vercel-env.sh` now injects it as the fixed literal `"true"` on both
  Production and Preview for every consumer app provisioned via `vercel-setup.sh` (across two
  further earlier changes), the same way `AUTH_TRUST_HOST` is injected; `vercel-teardown.sh` removes it on
  teardown. GCP Cloud Run and local/CI still never set this var, so they are unaffected.
  When unset, or set to anything other than the
  literal string `"true"` (fixed in this same change — the original branch used a truthy check,
  so `USE_NEON_ADAPTER=false` or `=0` would have incorrectly enabled it), behavior is unchanged:
  falls straight through to the existing `PrismaPg` branch. Verified: with the var unset, `false`, and `0`, the log line stays
  `Using direct database connection for Prisma Client` (existing `PrismaPg` path, byte-for-byte
  unmodified); with the var set to `true`, the log line switches to
  `Using Neon adapter for Prisma Client`. Reconciled with the `pinSslModeVerifyFull()` fix above
  on a `develop` re-merge: `@neondatabase/serverless` (the driver behind `PrismaNeon`) bundles its
  own copy of `pg-connection-string` with the same `sslmode` deprecation handling as `pg`, so the
  Neon branch's connection string is now piped through `pinSslModeVerifyFull()` too, right before
  constructing the `PrismaNeon` adapter — same guard, same reasoning, applied to both code paths
  instead of leaving the new one exposed.
- Added `scripts/lint_prj_synced.py` (`npm run lint:prj`) for consumer projects to lint only their own `prj/`-tracked `.ts`/`.tsx` files, at their real synced destination paths, without linting this repo's own templates or a consumer's fully generated codebase (see `docs/knowledge/consumer-prj-scoped-lint.md`). Runs `prj:sync`, parses its own `copied`/`merged` stdout as the source of truth for what to lint, and fails closed (non-zero exit) if that list is empty for any reason — never silently lints nothing and reports success. Verified standalone (no `../prj` present): fails closed as expected. Verified with a synthetic `../prj` containing one clean and one syntactically-broken `.ts` file: lints both, exits non-zero on the broken one. Does not cap the ESLint warning count (errors-only gate), unlike this repo's own `lint` script — see the knowledge doc for why a shared ceiling would not be meaningful across two structurally different populations.
- Set `x-generate.test: false` on `approval_flow` — its generated CRUD Cypress specs (desktop/mobile/API) and support helper are being replaced by hand-written coverage that already exercises the entity_name filter/validation design from an earlier change in `cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts`, placed directly in this repo's `cypress/e2e/` so it reaches every consumer via the submodule. Verified via `generate-code`: the three specs, `cypress/support/approval_flow/helper.ts`, and the task registry entry in `cypress/support/generated-tasks.ts` are no longer written (confirmed against `.generated-manifest.json`).
- Refactored `approval_flow_same_entity_autocomplete_filter.cy.ts` to seed its own two `Role` rows via direct `POST /api/role` calls instead of `cy.task('db:populateApprovalFlowDependencies')`, which only existed while `approval_flow`'s generated test helper (`cypress/support/approval_flow/helper.ts`) was being written — now that `test: false` removes that helper, the spec would otherwise fail its `beforeEach` on every run. Verified: 7/7 tests pass (`cypress run --spec cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts` against a real build), and a full-repo grep confirms no other spec references the removed generated task.
- **Removed the dead in-process notification store from `lib/_notifier.ts`**: the module-scope
  `console.log` on import (`[_notifier] in-memory notification store initialized...`) — audible during
  every `next build` and `next dev`/`next start` boot — described a `Map<userId, Notification[]>` read
  path (`listNotifications()` / `unreadCount()` / `markAllRead()` / `clearInbox()`) that had zero
  production callers: `app/api/notifications/*` has read the `notification` Prisma table directly since
  the table was introduced, and a full-repo grep (source + generated-code templates) found the
  only callers of those four functions to be this module's own `lib/_notifier.test.ts`. Removed the
  `console.log`, the `Map`, `pruneExpired()`, and the four dead functions plus `_resetForTests()`;
  `notify()` (the write path — 6 real call sites, plus the `service.ts.jinja2`/`test_helper.ts.jinja2`/
  `actions.ts.jinja2` generator templates) is untouched apart from its return type going from
  `Notification` to `void` (the return value was unused everywhere). `INBOX_CAP`/`TTL_MS`/`type
  Notification` are kept — `app/api/notifications/route.ts` imports all three for its own DB-side
  cap/TTL. Corrected the module's header doc comment and `docs/knowledge/notification-triggers.md` (both
  described the now-removed Map) and a stale "`notify()` itself is in-memory" comment in
  `lib/_notifyApprovalRequest.ts`. `lib/_notifier.test.ts`'s in-memory-only coverage (per-user isolation,
  50-entry FIFO cap, 7-day TTL eviction, `unreadCount`/`markAllRead`/`clearInbox`) was removed along with
  the code it tested; the two tests that cover `notify()`'s own DB write (success + swallowed write
  failure) were kept and updated for the `void` signature.

### Security
- **Value-level write lockdown for `x-approval` entities**: a value that
  `on_approved.set_fields`/`on_rejected.set_fields` writes when an approval request is
  approved or rejected (e.g. a `status` field's `approved`/`rejected` value) could
  previously also be written directly by an ordinary user through the generated form, the
  REST API, or CSV import — nothing stopped a create/update call from setting the field to
  that value outright, bypassing the approval/rejection step entirely. `code_generator/
  helpers/schema_helpers.py`'s new `derive_approval_locked_values()` derives, per entity
  and per field, the exact value set declared by that entity's own `set_fields`; the
  shared server-side validator (`service_validation.ts.jinja2`, the single path both the
  Server Action and the REST route call) and the CSV import route
  (`api_import_route.ts.jinja2`, which bypasses that shared validator and needed its own
  copy of the same check) both now reject a client-submitted value from that set, while
  still allowing a no-op resubmit of a record's own current value so routine edits to
  other fields on an already-approved/rejected record are not blocked. The generated form
  (`AppFieldSelect`) also disables the option in the UI, as a usability aid — the two
  server-side checks are the actual safety boundary, not the disabled UI option. Coverage
  is not uniform: which entity is fully protected (both `on_approved` and `on_rejected`
  declare `set_fields`) versus only partially protected (just one of the two does) versus
  not protected at all (neither does) depends entirely on that entity's own schema
  declaration — this change does not itself change which entities declare what. An
  already-generated consumer app only gains this protection after its next
  `generate-code`.

### Added
- **CSV export/import and approve/reject now accept `X-API-Key` as well as a browser session**:
  `api_export_route.ts.jinja2`, `api_import_route.ts.jinja2`,
  `split_action_route.ts.jinja2`, and the two static `app/api/approval_request/[id]/{approve,reject}/route.ts`
  routes previously resolved the caller exclusively via `getSessionUserId()`/`requireSession()`,
  so an external API-key client could never call them — only a logged-in browser session could.
  Added `resolveActorId()`/`requireDualAuth()` to `lib/api-auth.ts` (same dual-auth pattern
  already used by `app/api/search/route.ts`: `X-API-Key`/`Authorization: Bearer` header when
  present, session cookie otherwise) and switched all five routes to it. Verified both paths
  behaviorally: API-key-only calls now succeed (export 200, import reaches CSV validation instead
  of 401, approve/reject reach their 404-not-found business logic instead of 401), and the
  pre-existing session-only path is unchanged. `split_action_route.ts.jinja2` has no exercised
  entity in this repo's own `json_schema.yaml` (no `x-splittable` declaration) — verified instead
  via direct Jinja2 template-render assertion and the existing `code_generator/tests/test_reservation.py`
  / `test_ledger_location_id_fk.py` / `test_ledger_item_naming_generalization.py` suites that
  already render this template with full context.
- **New API-only regression test for FK read-permission graceful degradation**: added
  "4.5 returns 200 for GET (list and detail) when the acting user cannot read `<fk target>`" to
  `test_api_spec.cy.ts.jinja2`, alongside the pre-existing "4.4 preserves `<fk>_id` ... omits it
  from the PUT body" — both pure `X-API-Key` (`cy.request`), no browser. Together they are the
  API-gate-covered counterpart of `fk_read_permission_graceful_degradation.cy.ts`.

### Changed
- **Generated API test spec (`test_api_spec.cy.ts.jinja2`) no longer authenticates via
  `cy.login()` except one deliberate case** (per a report from the project owner: `api/approval_flow.cy.ts`
  still drove the browser login screen even after an earlier change added `X-API-Key` support to
  export/import/approve/reject). 15 `cy.login()` call sites classified one by one: 11 in the
  approve/reject block (12.1–15.2) simply predated that dual-auth change and had never been
  updated to use the `api_key` the same test fixtures already expose (`setup.approverUser.api_key`
  etc., the exact pattern the adjacent resubmit tests already used) — switched to `X-API-Key`. 2
  in the export/import permission-denied pair (7.5/7.6) carried a comment claiming the route
  "never reads X-API-Key"; that claim is now false — switched to
  `db:createLimitedApiUser`, the same helper 7.2–7.4 already use, making 7.5/7.6 identical in
  shape to their siblings. 2 more (an export/import happy-path block's `beforeEach`, and a
  search-coverage block) had no route-specific reason to use a session at all — switched to
  `TEST_API_KEY`. The one exception is new: `N14 also authenticates via a NextAuth session
  cookie (dual-auth)`, a single canary proving the session-cookie half of `resolveActorId()`
  still authenticates, kept because eliminating every `cy.login()` would silently stop measuring
  that half of dual-auth's "works via either" guarantee. See
  `docs/knowledge/testing-cypress.md`'s "API test / UI test boundary" section for the policy and
  `code_generator/check_generated.py`'s new `test:unexplained-login` gate rule that now enforces
  it (regenerated output confirmed `cy.login`-free except the one marked canary; full
  `test:e2e:cy:api` run: 248/270 passing across all 16 relevant specs, the 22 failures isolated
  to a single pre-existing, untracked, gitignored orphan spec — `personal_note.cy.ts`, 404s
  because the `personal_note` entity no longer exists in `json_schema.yaml` — unrelated to this
  change and present before it).
- **`fk_read_permission_graceful_degradation.cy.ts` moved from `cypress/e2e/api/` to
  `cypress/e2e/`**: every case in this hand-written spec drives the browser
  (`cy.visit`/`cy.login`/`cy.selectAutocomplete`) and never issues a raw `cy.request` — it was
  never actually `test:e2e:cy:api`-gate coverage despite living under `api/`. It now sits under
  `test:e2e:cy:ui`'s spec glob (`cypress/e2e/*.cy.ts`) instead. (Note: the task instruction that
  prompted this move said "move to `cypress/e2e/ui/`", but no such subdirectory exists in this
  repo — `cypress/e2e/*.cy.ts` is the actual UI-spec convention; moving it into a nonexistent
  `ui/` subdirectory would have dropped it from both gates' spec globs silently.)

### Fixed
- **Server Action errors (permission denied, unique-constraint violations, stale updates, and
  more) showed a "Minified React error #441" screen with no actionable text instead of the
  underlying reason** (design from an earlier proposal): Next.js strips a thrown error's `message`
  at the Server Components render boundary in production, replacing it with the minified error
  text and an opaque digest — this happened for every error thrown by `upsertXxx`/`removeXxx`'s
  service-layer calls, regardless of how actionable the underlying error was. Fixed per
  `docs/knowledge/error-message-framework.md`'s Layer 2 design: added a typed `AppError`/
  `ActionResult` taxonomy (new write-once `lib/_errors.ts`), converted the named throw sites
  (`lib/authz.ts`, `lib/normalize.ts`, `service.ts.jinja2`, `service_validation.ts.jinja2`) to
  throw `AppError`, and had `actions.ts.jinja2`'s `upsertXxx`/`removeXxx` catch it and return an
  `ActionFailure` value instead of letting it propagate — the value survives production
  untouched, since it is data, not an exception crossing the render boundary. The client renders
  the corresponding message via a new `Errors` i18n namespace (`messages/en.json`, translated to
  `messages/ja.json`). `removeXxx` (bulk delete) was extended beyond the original per-file
  checklist, since a permission-denied delete would otherwise still crash — `DataGridClient.tsx`/
  `CardListClient.tsx` now show the failure via `AppAlert` and roll back the optimistic row
  removal instead. Also fixed, found only empirically during implementation (no throw site for it
  existed anywhere): a genuine DB-level `@unique`/`@@unique` violation surfaced as an uncaught
  `Prisma.PrismaClientKnownRequestError` (P2002) — `service.ts.jinja2` now converts it to
  `AppError('CONFLICT', ...)`, reading the violated field name via a new `p2002Field()` helper
  (`lib/_errors.ts`) written against this Prisma version's actual driver-adapter error shape,
  which differs from the classic `meta.target` most Prisma examples show. Org isolation
  violations continue to surface as `NOT_FOUND` (unchanged from earlier behavior) — never as
  "permission denied", which would leak that the record exists in another organization. `error.tsx`
  now shows a static, safe `Errors.pageError` i18n key instead of a hardcoded string; it remains
  the fallback for truly unexpected errors and for permission checks on Server Component pages
  (`assertPermission`, list/detail access), which cannot return a data value the way a Server
  Action can. New hand-written UI e2e coverage,
  `cypress/e2e/error_message_delivery.cy.ts`, exercises all three scenarios end-to-end
  (unique-constraint violation, stale update, permission denied) against a full production build,
  confirming the inline message renders and the page never falls through to `error.tsx`. Full
  mandatory gate green (1238 pytest, 459 vitest, 240 API e2e — 0 skipped in any suite — plus the
  new UI spec, 0 npm audit findings).
- **`get<Entity>ChunkForExport()` silently exported zero rows for an `X-API-Key`-only caller
  with genuine `read` permission** (found while removing `cy.login()` from generated
  export API tests): `getters.ts.jinja2`'s CSV-export getter has two branches for computing
  permissions — the `should_filter_by_org` branch correctly calls
  `getModelPermissions('<entity>', userId)` with the `userId` the export route already resolved
  (via `resolveActorId()`'s dual-auth) and passed in; the other branch called
  `getModelPermissions('<entity>')` with no `userId` at all, which falls back to
  `getSessionUserId()` inside `authz.ts`. Every export API test always authenticated via
  `cy.login()` (a real session cookie), so this was invisible — `getSessionUserId()` happened to
  resolve the same actor. Switching those tests to `X-API-Key` (no session cookie present)
  exposed it: `getSessionUserId()` returns `null`, `getModelPermissions()` returns
  `EMPTY_FLAGS`, and the export's own access-where builder filters out every row — a 200 response
  with an empty CSV body, not an error, for a caller the *route* had already confirmed has read
  access. Fixed by passing `userId` through in both branches. Verified: `dashboard.cy.ts`'s N6/N11/
  N12/N13 (which use `to.include` assertions that fail on empty data, unlike N1/N2/N5's
  `to.not.include`, which pass vacuously either way) went from failing (`expected [''] to include
  'name'`) to passing after the fix, confirmed on a from-scratch server + build.
- **`FormUpsert`'s readonly-field display was type-blind, showing raw FK ids with a nonexistent
  i18n key instead of the relation's label**: the readonly-field loop in
  `form_upsert_context()` rendered every readonly field the same way —
  `String(src.<prop>)` with `tf(to_camel_case(prop))` as the label — regardless of type. For a
  relation, the property name is `<rel>_id`, so this produced an untranslated
  `tf('parentGoodsReceiptLineId')` label and the raw id as the value instead of the relation's
  resolved `labelField`. The same blind loop also affected enum (raw untranslated stored code),
  date/datetime/time, boolean, and image (`format: uri`) readonly fields, though those remained
  legible (unstyled) rather than incorrect. Fixed by extracting `form_view_context()`'s existing
  per-type dispatch (FormView is always read-only, so it already rendered every type correctly)
  into a shared `_readonly_display_field()`, reused by both `form_view_context()` and
  `form_upsert_context()` — the two paths can no longer render the same field differently.
  Also added a fail-closed check: an `x-readonly-fields` entry that doesn't resolve to an actual
  property (e.g. the relation name instead of the FK column) now raises at generation time
  instead of silently leaving the field fully editable. See
  `docs/knowledge/readonly-field-form-rendering.md`.
- **Generated "requestor can re-submit a rejected request" approval test used a page-wide,
  unscoped `[aria-label="Re-submit"]` lookup** (real case: `purchase_per_item.cy.ts`
  7.8, seen as `cy.click() can only be called on a single element. Your subject contained 2
  elements.` in a full 150-spec CI run, passing in isolation): `ApprovalSection.tsx` renders one
  Re-submit `IconButton` per `approval_request` row with `status === 'rejected'`, all sharing the
  same static `aria-label="Re-submit"` — and an entity can legitimately have a second, "ungated"
  `approval_flow` (`requestor_role_id: null`, applying to every requestor) alongside a role-gated
  one (see the adjacent 7.1 test's own comment: "both flows apply → 2 approval_requests"), so once
  more than one of an approvable's requests is rejected, more than one element matches. Two full
  local reproductions matching the exact failing CI commit and exact preceding 23-spec order could
  not force the second row, so the triggering condition from that CI run stays unconfirmed — but
  the selector was unsafe by construction regardless, the same "only one graspable" assumption
  already fixed for `parent1` in an earlier change, the self-referential decoy in another earlier change, and
  `goods_receipt_line` candidate selection. Fixed by scoping the interaction to the specific
  `approval_flow`'s own table row (via its approver-role-name `<td>`, exact-matched with the
  existing `exactRe()` helper, then `.closest('tr')`) instead of a page-wide selector. The
  sibling `[aria-label="Approve"]` / `[aria-label="Reject"]` lookups in the same describe block
  (tests 7.4/7.5/7.6/7.7/7.9) carry the identical latent hazard and were left unscoped — noted for
  a follow-up cmd, out of this task's scope. Verified: `purchase_per_item.cy.ts` 9/9 passing
  individually and in a full 23-spec CI-order run (`approval_flow.cy.ts` through
  `purchase_per_item.cy.ts`, matching the exact failing CI run's spec order) against the exact
  submodule commit that failed in CI; `code_generator` pytest suite 1227 passed, 0 skipped after
  `generate-code`.
- **`helper_context()`'s per-dependency loop variable shadowed the entity-level `title`**
  (`code_generator/generators_test.py`, found verifying the fix above): the multi-FK-to-same-target
  dep-splitting loop (e.g. `inventory_movement`'s `from_inventory_id`/`to_inventory_id`, both
  pointing at `inventory`) reused the bare name `title` for each per-dependency label, permanently
  overwriting the outer `title = to_title_case(parent)` for the rest of the function — so
  `helper_context()`'s returned `title` (used by `test_helper.ts.jinja2` to name every approval-flow
  seed role, e.g. `Test {{ title }} Approver Role`) silently became the *last-processed FK's* label
  (`"To Inventory"`) instead of the entity's own title (`"Inventory Movement"`), while
  `spec_context()` (no such loop) still returned the correct title — a cross-context mismatch
  invisible until a test asserted on the seeded role's display text. The fix above's
  `exactRe('Test {{ title }} Approver Role')` scoping does exactly that, so it surfaced the bug on
  every entity hitting this pattern (`inventory_movement.cy.ts` 7.8 failed:
  `Expected to find content: '/^Test Inventory Movement Approver Role$/' within the selector: 'td'
  but never did`) — the old page-wide `[aria-label="Re-submit"]` selector never looked at role text,
  so the mismatch had no test-visible effect before this task. Renamed the loop-local variable to
  `dep_title`. Verified: instrumented `helper_context()`/`spec_context()` directly for
  `inventory_movement` (`title` now `'Inventory Movement'` from both, previously `'To Inventory'`
  vs `'Inventory Movement'`); `inventory_movement.cy.ts` 14/14 passing standalone after
  `generate-code`; `code_generator` pytest suite unaffected (1227 passed, 0 skipped, same count
  before and after this fix — no fixture relied on the shadowed value).
- **A parent record created with a NULL `organization` (added in an earlier change that made the relationship optional) became permanently
  un-updatable — `upsert<Parent>()`'s pre-permission existence check threw `Error('Not found')`
  even for its own creator**: `generators.py`'s `_actor_and_existing_block()` filtered
  strictly on `organization_id: { in: _orgIds } }`, which never matches `NULL` in SQL, unlike its
  three sibling org-filter sites (`remove<Parent>()` in `actions.ts.jinja2`,
  `get<Parent>Detail()` in `getters.ts.jinja2`, and the CSV import route in
  `api_import_route.ts.jinja2`), which already admitted a NULL-organization row via the same
  `org_relationship_optional` OR-null clause. Wired the same (previously computed but unused)
  context value into the upsert existence check so create/update, delete, and read now treat a
  null organization consistently. Verified against proj_c's `parent1` entity in an isolated
  worktree: the update-existence-check regression case now passes; `code_generator` pytest suite
  1220 passed, 1 skipped (pre-existing, unrelated), 0 failed.
- **Cross-entity global search never surfaced a row whose `organization` relationship was NULL**:
  `search_helpers.ts.jinja2`'s per-entity access clause filtered strictly on
  `{{ org_id_field }} IN (${ associatedOrgIds })`, which never matches `NULL` in SQL. Once an
  org-scoped entity's `organization` relationship becomes optional (per the earlier change noted above), an org-less row
  was invisible to `buildSearchQuery()` for every caller, including its own creator — the one
  remaining call site still using the pre-that-change unconditional-deny shape (every other
  `org_relationship_optional` site — `actions.ts.jinja2`, `getters.ts.jinja2`,
  `api_detail_route.ts.jinja2`, `api_import_route.ts.jinja2` — already had the OR-null admission
  via that same set of earlier changes). Fixed by wiring the same `org_relationship_optional` computation into
  `generate.py`'s search-entity context (search builds its own independent Prisma.sql fragments,
  so it needed its own plumbing rather than reusing the object-filter templates' existing
  context), gated at both org-filter sites in the template (the direct access clause and its
  `parent.`-qualified `no_page_children` sibling). Verified against a real Postgres DB via proj_c's
  `parent1` entity: `api/parent1.cy.ts`'s N10 spec failed with `expected false to equal true`
  before this fix, passed after. See `docs/knowledge/org-optional-entity-support.md` for the full
  design context, including a follow-up gap found but not fixed in this pass (CSV import's
  dotted-FK lookup-target org filter doesn't admit a NULL-organization row on the lookup target
  side either).
- **Generated 3.3 "edits with mixed changes" test for a `user`-FK primary field selected a
  `Test User A` row that was never seeded, failing the `cy.selectAutocomplete` assertion**
  (real case: `shift`/`shift_template`): `spec_context()`'s `is_user_account` primary-FK
  branch builds `edit_update_value` from the letter-suffixed dependency instance (`Test User A`,
  from `_seed_relation_label_value`'s `unique_index=None` fallback) but only routed the edit
  through `populate{Pascal}Dependencies()` (`use_deps_in_3_3`) for the `selectAutocomplete`
  create/fail-edit paths — the `is_user_account` branch of `populate{Pascal}Data`'s own
  per-iteration loop (`test_helper.ts.jinja2`) only ever creates `Test User ${i}`, never a
  letter-suffixed row, so relying on `populate_count_3_3` alone left the target row absent from
  the DB. Fixed by setting `use_deps_in_3_3 = has_deps` for this case too (`generators_test.py`),
  so the 3.3 edit is routed through the dependency populator like the other `is_user_account`
  paths already are. Verified: `shift.cy.ts`/`shift_template.cy.ts` (desktop + mobile) 40/40
  passing in an isolated worktree; full `code_generator` pytest suite 1216 passed, 0 skipped.
- **Generated Cypress test's per-entity `callIndex` counter (an earlier isolation counter,
  `` `Test {Title} ${callIndex}_${i}` ``) persisted for the life of the Cypress plugin process, not
  per test case** ("per-test-case callIndex reset"): a generated spec's own `it()` blocks
  are hardcoded to expect `callIndex=0`, but two `it()` blocks in the same spec calling the same
  `populate*Data`/`populate*FullData` helper gave the second block `callIndex=1`, failing its
  assertions — and separately meant a single `it()` run in isolation could produce different
  generated values than the same `it()` run as part of the full spec (order-dependence). Fixed by
  adding a `_reset{Pascal}CallSeq()` export to the generated test helper, wiring it to a
  `db:reset{Pascal}CallSeq` Cypress task, and calling that task at the top of every generated
  spec's `beforeEach` — desktop, mobile, and API. (The API spec template was missed in the first
  pass — `api_spec_context()` never computed `primary_fk_dep` either, the same gap the desktop/mobile
  contexts had — and added in a follow-up once code review caught it before merge.) Guarded by the
  same condition (`primary_fk_dep` with `extra_required_fields`, not a user-account FK) that decides
  whether the counter exists at all, so entities that never needed the counter get none of the new
  plumbing. Hand-written specs calling the same populate functions are not automatically covered by
  this reset (each has its own `beforeEach`) — see the new rule and worked example in
  `docs/knowledge/cmd614-test-data-uniqueness-design.md` §6.2 for how to keep such specs safe
  (round-trip the actual seeded value, or add the same reset call). Verified end-to-end against
  proj_b's `approval_flow` (its only entity meeting the guard condition): isolated single-`it()`
  runs and full-suite runs produce identical generated values; full mandatory gate (lint / pytest /
  vitest / mention-gate / e2e:build / check:generated / cy:api 236/236 / cy:ui 177/177 / npm audit /
  pip-audit) green.
- **`api_import_route.ts.jinja2`'s composite-labelField FK resolution referenced
  `formatLabelValue()` with no import once a labelField segment needed date/time formatting, breaking
  the TS build**: an earlier fix removed this import as unconditionally-dead lint debt — correct at
  the time (no entity's `import_label_expr` called it yet), but `import_label_expr` is a *string built
  in `build_context.py`* and spliced in via `{{ }}`, so a static read of the `.jinja2` source can never
  see whether it calls `formatLabelValue()`. A later labelField-composition change made composite
  labelFields with date/time segments call it (real case: proj_g `goods_receipt_line`, labelField
  `[product.code, lot_number, expiration_date]` — broke a downstream consumer's build with "Cannot find
  name 'formatLabelValue'"). Fixed by gating the import on `import_uses_format_label_value` (`build_context.py`:
  `any(s.get('has_format') for s in import_fk_specs)`, threaded from `build_label_expression()`'s own
  `has_format` — the same mechanism 7 other templates already use for this same import). Both directions
  verified: a composite labelField with a date segment gets the import (proj_g `goods_receipt_line`,
  reproduced via a real `build_context()` call with a date-typed labelField segment — see
  `TestCompositeLabelFieldImportUsesFormatLabelValue` in `test_build_context.py`), and one without still
  omits it (no regression of the original lint-debt fix). Re-audited the same commit's other two
  dead-binding fixes (`fkData`, `richPerms`) — neither shares this blind spot, both gate usage behind
  the identical static `{% if %}` as their declaration. Also fixed, same file (code review finding on a
  downstream consumer PR): an `eslint-disable-next-line` comment on the auto-create-OTO branch sat two
  lines above the `as any` it was meant to suppress (directly above `await tx.{{ model }}.create({`
  instead of the `data: { ...(action.data as any),` line), silently failing to suppress anything.
  Regression tests (deviation-injection confirmed: revert either fix → new test fails at the same
  spot): `test_format_label_value_imported_when_composite_spec_needs_it` /
  `..._import_absent_when_flag_false_even_with_composite_spec` /
  `test_bridge_create_eslint_disable_immediately_precedes_as_any` in `test_import_template_branches.py`.
  Full `code_generator` pytest suite: 1181 passed, 0 regressions. See
  `docs/knowledge/cmd607-generator-lint-debt-fix.md` (correction note under Root cause 2, item 1).
- **Generated UI test scaffold no longer tries to fill an `x-server-value` field through the
  form.** Two `spec_context()` code paths (create/fail-edit fill commands via
  `req_ua_spec`/`all_ua_spec`, and the "edits with mixed changes" test's `edit_primary_cmd` when
  the field is also the entity's `x-display.table` primary column) generated
  `cy.selectAutocomplete()` against a field that's always excluded from every form input by
  `x-server-value`'s design — the form never renders that autocomplete, so the generated test
  failed outright (`Expected to find element: 'filter', but never found it`). Both paths now skip
  such fields entirely. See `docs/knowledge/x-server-value-actor-delegation.md`.

- **Generated test helper's find-or-create dep block gave `create()` an `include` for
  composite-labelField resolution but not the paired `findFirst()`, a latent TS2551/TS2339 type error
  in every affected `cypress/support/*/helper.ts`**: when a many-to-one relationship's
  `labelField` is composite (e.g. `[purchase_order.po_number, item.sku]`), the generated dep record's
  label expression reads an included relation (`record.purchase_order?.po_number`) that only exists on
  the `create()` branch's inferred type — the `findFirst()`-declared variable's type lacks it, since
  `test_helper.ts.jinja2` only spliced `dep.prisma_include_str` into `create()`. Reproduced in proj_g's
  `goods_receipt_line/helper.ts` (`purchase_order_line`/`asn_line` deps). Currently invisible to every
  gate — `tsconfig.json` excludes `cypress/` from `next build`'s type-check scope, and `cypress run`
  transpiles support files without type-checking — confirmed via an isolated `tsc --noEmit` pass and a
  deviation-injection round-trip (revert → error reappears at the same 2 lines; re-apply → clean).
  Fix: the same conditional `include` now applies to both the `findFirst()` and `create()` call in all
  5 identically-shaped call sites in the template. proj_g's full `test:e2e:build` + `test:e2e:cy:api`
  (30 specs / 616 tests) both pass post-fix, and an isolated `tsc --noEmit` over proj_g's entire
  `cypress/support/**` confirms zero remaining errors of this class across all 5 composite-labelField
  occurrences in its schema. proj_c has one dormant occurrence of the same latent bug class (not
  exercised here — its generator pointer hasn't bumped to include this fix yet). Covered by a new
  regression test (`test_composite_labelfield_helper_findfirst_include.py`, following an established convention: render
  the actual jinja2 template, assert the generated TypeScript). Full `code_generator` pytest suite:
  1130 passed (+2 new), 0 regressions. See
  `docs/knowledge/composite-labelfield-helper-findfirst-include-mismatch.md`.

- **The CSV-import commit-time CREATE path built its Prisma `create()` call entirely from the
  dry-run-computed row data, bypassing the same auto-create-bridge-FK pre-create mechanism
  (`one_to_one_pre_creates` / FK-merge) that the normal `add<Entity>()` service function already
  uses**: any entity with a required internal bridge FK (e.g. `approvable_id` on an
  `x-approval` entity) failed CSV-import row creation at commit time with a Prisma
  `PrismaClientValidationError` for the missing FK, even after an earlier fix correctly let
  `import_can_create` come out `true` for such entities. The dry run (which never touches the DB)
  reported success and issued a `confirmToken`, making the failure visible only on commit — a
  concrete trap for anyone confirming a dry run that "succeeded". Concrete trigger: `goods_receipt_line`
  (an `x-approval` entity) importing a CSV row whose natural key doesn't match an existing row.
  `api_import_route.ts.jinja2`'s commit-time create branch now consumes the same
  `one_to_one_pre_creates` / `one_to_one_fk_data_lines` context vars `service.ts.jinja2` already
  renders — not a new mechanism, not a hand-listed entity name — gated on whether the entity has
  any auto-create one-to-one relations at all, so entities without one render byte-identical output
  to before. `one_to_one_fk_data_lines` is now also exposed standalone in `build_context.py`'s
  returned context dict (previously inlined only into `parent_data_obj`, unavailable to any
  template other than `service.ts.jinja2`). Verified both directions: a non-bridge entity's
  generated import route is unchanged, and a direct DB-level replay of the fixed
  `goods_receipt_line` transaction (against a real Postgres instance) succeeds and correctly
  populates `approvable_id`, while the same data without the fix reproduces the original
  `PrismaClientValidationError`. New/updated pytest coverage in `test_import_template_branches.py`
  and `test_auto_create_oto.py` fails against the pre-fix template (deviation injection). Full
  `code_generator` pytest suite: 1134 passed, 0 skipped. See
  `docs/knowledge/import-create-missing-bridge-fk-fix.md`.

- **An org-scoped entity's `organization` relationship can now be declared optional without
  breaking CREATE or making org-less rows invisible.** Two gaps, both only surfacing once an
  entity's `organization` relationship is removed from `required`: (1) `service.ts.jinja2`'s
  CREATE-path org-membership check called `Array.includes()` on a value that is `string | null`
  once the relationship is optional — a real `next build` compile error, not a lint nit — fixed by
  mirroring the guard the UPDATE path already had; (2) every generated read/write scope filter
  (`organization_id: { in: [...] }`) never matches SQL `NULL`, so an org-less row became invisible
  to every org-scoped actor, including its own creator — confirmed as a real, not theoretical,
  break: a testbed entity's basic generated CRUD tests failed en masse the moment its organization
  relationship became optional and it was added to the standard test-permission infrastructure.
  Fixed with a new `org_relationship_optional` flag that admits `organization_id: null` alongside
  the actor's own organizations, applied everywhere the current model's own org scoping is
  checked (list, detail, delete action, PUT/DELETE existence check, CSV import match-by-key). A
  required-org entity's generated output is unaffected. See
  `docs/knowledge/org-optional-entity-support.md`.

- **CSV import's dotted/composite-label FK lookup left the `organization` lookup target itself
  completely unfiltered** — the existing `('organization', 'user')` exclusion in the org-filter
  discriminant is correct (neither model has an `organization_id` column to filter candidates on),
  but for `organization` specifically it meant no filter applied at all: a CSV row naming *any*
  organization in the system, not just one the actor belongs to, would resolve and get attached.
  Fixed with a new `lookup_entity_filter_by_self_id` flag that filters organization candidates by
  their own `id` being in the actor's associated-org list instead. See the "Follow-up" section of
  `docs/knowledge/csv-import-dotted-fk-org-filter.md`.

- **`approval_flow.preceded_by`/`followed_by` rendered a different label on the View page than on
  the Edit page for the same row**: View rendered `approver_role.name || entity_name`
  (dropping `entity_name` entirely whenever a role was set), Edit rendered
  `entity_name + ' - ' + approver_role.name`. The legacy `secondaryLabelField` mechanism that caused
  this (only honored in one of the several label-rendering call sites) is removed entirely — zero
  remaining references, grep-verified. `labelField` is now the composite list form
  (`[entity_name, approver_role.name]`), rendered identically everywhere via the existing
  `build_label_expression()` helper. Fixed a related crash: `generators_test.py`'s list-children
  spec-label prediction called `.split()` directly on a labelField, assuming it was always a string
  — list-form labelFields now route through the existing `_seed_relation_label_value()` helper.
  Self-referential many-to-many searches (the pattern `preceded_by`/`followed_by` use) now pass the
  record being edited through as `context.formValues`, making the previously-unreachable
  `autocomplete_filter.ts` insertion point usable for this case; every other entity's default `{}`
  stub is unaffected. Added `lib/approval_flow/autocomplete_filter.ts`: narrows
  `preceded_by`/`followed_by` candidates to the same `entity_name` as the record being edited
  (same-`entity_name` approval chains — e.g. a `purchase_order` chain's draft/manager/finance
  stages — are an intentionally supported configuration, not test-data noise). Verified: 1130
  pytest passing (0 skipped), full `test:e2e:cy:api` gate 236/236 passing (0 skipped), plus a new
  hand-written `approval_flow_same_entity_autocomplete_filter.cy.ts` (2/2 passing) proving
  same-entity_name candidates appear, different-entity_name candidates don't, and View/Edit render
  the identical label.
  
- **`_create_feasible` (the CSV CREATE-feasibility gate) never excluded FKs to internal bridge
  models (e.g. `approvable_id`, `x-relationship.type: one-to-one_bridge`), wrongly counting them as
  unfillable required columns and gating off `import_can_create`**: a bridge FK is
  server-managed plumbing the service layer creates and wires at CREATE time — it was already
  correctly excluded from CSV *export*, but nothing then removed it from the required-fields gap
  set, so it stayed a "gap" and `import_can_create` came out `False`. Combined with
  `x-generate.edit: false`, this collapsed the entire generated `import/route.ts` to the
  `ENTITY_IMPORT_NOT_SUPPORTED` 400 stub (`api_import_route.ts.jinja2:24`), not just CREATE — the
  concrete trigger is `goods_receipt_line` (a pending edit:false ruling for that entity from an earlier task).
  A prior earlier test for this exact scenario asserted the buggy value as correct, under the
  mistaken belief the exclusion already happened; that test's assertion and rationale are corrected
  as part of this fix. `_create_feasible` now subtracts `get_internal_bridge_fk_prop_names()` —
  the same shared helper `validate.py` and `generators_test.py` already call — rather than a
  hand-maintained name list. A genuinely unfillable required FK to a real (non-bridge) entity is
  unaffected and remains infeasible as before. Verified both directions via an isolated
  `build_context()` harness (no entity in this repo's own schema combines a required bridge FK with
  edit:false) and updated/new pytest coverage in `test_build_context.py`, including deviation
  injection (assertions fail against the pre-fix code). Full `code_generator` pytest suite: 1131
  passed, 0 skipped. See `docs/knowledge/create-feasible-internal-bridge-fk-fix.md`.

- **Generator-side lint debt invisible to CI**: `npm run generate-code && npm run lint`
  surfaced 83 eslint warnings (0 errors) that CI's `Lint` job — which runs before `generate-code`,
  never after — could never see. Broken down: 48 were a Chai getter-assertion false positive
  (`expect(x).to.be.true`/`.to.exist` read as unused expressions by
  `@typescript-eslint/no-unused-expressions`, which has no notion of Chai's assertion-chain side
  effects), fixed by scoping that rule off for `cypress/e2e/api/**/*.cy.ts` in `eslint.config.mjs`.
  The remaining 30 `no-unused-vars` warnings were three unrelated dead-binding bugs in
  `api_import_route.ts.jinja2` (`formatLabelValue` imported but never referenced; `fkData` declared
  and written even when `import_can_create` is false and nothing reads it) and
  `api_bulk_route.ts.jinja2` (`richPerms` bound even for `x-self-only` entities, which never read it
  — the permission check itself still runs, just unbound), plus two ordinary stale imports in
  hand-written (non-generated) `audit_log` test files, plus 22 warnings whose triggering condition is
  scattered across dozens of independent scenario branches in `test_spec.cy.ts.jinja2` — fixed via two
  new self-healing post-render helpers in `generate.py` (`_strip_unused_exact_re_helper`,
  `_prefix_unused_then_callback_params`) that inspect the actual rendered TypeScript output rather
  than trying to mirror every branch condition in Python. 83 → 5 warnings (the remaining 5 are an
  unrelated, pre-existing `@next/next/no-img-element` suggestion on static `components/_standard/*`
  files, deliberately out of scope). 15 new pytest tests, 0 regressions (1130 → 1145 passed, 0 SKIP).
  See `docs/knowledge/cmd607-generator-lint-debt-fix.md`.

- **x-reservation test-helper generation only ever resolved the pool entity's criteria-field FK,
  silently omitting any OTHER required FK on the pool entity**: when a pool entity (e.g.
  `inventory`) has a required FK beyond the one named in `x-reservation.request.criteria` (e.g.
  `location_id`, added 2026-08-06 alongside `product_id`), three separate generated-test code paths
  built `prisma.<pool>.create()` calls that omitted it, all failing at seed time with a
  missing-required-column Prisma error: `_reservation_base()`
  (`test_reservation_helper.ts.jinja2`'s `seedReservationXxx*` helpers), and `helper_context()`'s
  `reservation_lines_pool_seed`/`reservation_nolines_pool_seed` blocks
  (`test_helper.ts.jinja2`'s `populate{{Pascal}}Dependencies()` pool-seed snippet — the one actually
  responsible for the reported failures: `cypress/support/purchase_order/helper.ts`'s
  `prisma.inventory.create()`, driving 20/27 failures in proj_c's `purchase_order.cy.ts` plus 1 in
  `purchase_order_reservation_gen.cy.ts`, 21 total). All three now reuse
  `resolve_dependencies()`/`get_entity_fk_deps()` (the same machinery `helper_context()` already
  uses for `populateXxxDependencies`) to resolve the pool entity's required FKs beyond the criteria
  field, including transitive chains — reusing an already-resolved dep var where one exists (e.g. a
  datagrid child's own autocomplete FK already pulled the same target in) instead of creating a
  duplicate row. Also fixes a latent, currently-dormant adjacent bug found while tracing this:
  `populate{{Pascal}}Dependencies()` returned `{}` unconditionally whenever `deps` and
  `reservation_nolines_pool_seed` were both empty, without checking `reservation_lines_pool_seed`.
  Entities whose pool has no extra required FK (the common case, e.g. `supply_request`/`supply_pool`)
  render byte-identical output. Covered by 15 new injected-fixture tests (following an established convention: render
  the actual jinja2 template, assert generated TypeScript sets the column) across
  `test_reservation_helper_pool_extra_fk.py` and `test_helper_pool_extra_fk.py`. Verified live in an
  isolated proj_c worktree, both specs isolated (28/28 passing, up from 7/28 before) and as part of
  the full 57-spec `test:e2e:cy:api` suite (976 tests: 936 passing/40 failing/9 red specs, up from
  915/61/11 before the fix — exactly the 21 targeted failures resolved, zero new failures anywhere
  else; SKIP=0 both runs). The 40 failures/9 red specs that remain are pre-existing and out of this
  fix's scope (37 failures across 8 specs are the separate hand-written-helper class fixed by
  an earlier change; 3 failures in 1 spec are an unrelated `x-self-only` 404-vs-403 issue). proj_g has zero
  `x-reservation` consumer entities (feature unused there) — confirmed by mechanically walking its
  schema with the fixed generator's own context builders, N/A for this bug class. Full
  `code_generator` pytest suite: 1127 passed, 0 regressions. See
  `docs/knowledge/x-reservation-pool-entity-extra-fk-fix.md`.

- **A field with a Prisma `@default(...)` but no schema `default:` marker (dynamic defaults like
  `now()`) or with a static default the generator ignored (number/boolean/plain-string) silently
  lost that default on the "new" page whenever the user left it untouched**: for
  `DateTime @default(now())` NOT NULL columns, the "new" page seeded `null`, the browser then
  submitted `''`, and the server turned that into `new Date('')` (Invalid Date) — crashing
  `create()` outright for any consumer entity with such a column (the concrete symptom this fixes:
  `inventory_transaction.occurred_at`-style fields in downstream consumers). Number fields with a
  nonzero default silently became `0`; boolean fields with `@default(true)` always submitted
  `false`; plain (non-enum) string fields with a default always submitted `''` — none of these
  crashed, but all silently discarded the schema's declared default. `_default_value()`
  (`page_new.tsx`'s initial form state) now seeds a writable default for all four field classes —
  `new Date()` for datetime fields excluded from `required:` while remaining DB non-nullable (the
  only surviving signal for a dynamic default, since `schema_deriver` deliberately omits the
  `default:` key for `now()`/`cuid()`/etc.), the schema's literal `default:` value for
  number/boolean/plain-string. `_new_prop_val()` (DataGrid child new-row seeding) already handled
  boolean/number correctly; only its plain-string/plain-string-enum branches needed the same fix.
  Also fixed a related `NumberField` JSX bug where `src.p || undefined` would have silently blanked
  a legitimate `0` default (`0 || undefined` is falsy) — changed to `??`. Verified via isolated
  before/after Cypress UI comparisons in both proj_g (the target crash flips FAIL→PASS, zero
  regressions) and proj_c (the full 86-spec/781-test UI suite is an exact match before/after — zero
  regressions). `test:e2e:cy:api` cannot exercise this class of bug at all (it drives the REST API
  directly, never the browser form's default-seeding JS) — a gate blind spot worth keeping in mind
  for this field-default family specifically. See `docs/knowledge/writable-default-value-fix.md`.
- **`npm run cleanup`'s defaults deleted write-once stubs while leaving true orphans behind, and a
  reordered `generate-code` → `cleanup` run silently deleted the entire just-generated tree**
  (building on an earlier fix that pointed cleanup at the Stage-4 built schema):
  `cleanup` now passes `--prune-orphans --keep-stubs` (the safe default — sweep stale entity
  boilerplate, keep customizable stubs) where it previously passed neither (orphans ignored, stubs
  deleted); `cleanup:all` keeps `--prune-orphans` alone (full clean-slate, stubs deleted too).
  `cleanup.py` also fails fast with an actionable message instead of a raw traceback when its
  schema argument doesn't exist, and now warns (without blocking) when
  `.generated-manifest.json` was written under a minute ago — running `cleanup` immediately after
  `generate-code` deletes every just-generated file, since they all hash-match and therefore all
  read as pristine-deletable; correct order is `cleanup` → `generate-code`, not the reverse.
  Separately, `build_user_schema.py`'s raw/view split silently dropped a bridge-child entity's
  `x-bridge` declaration whenever that entity also carried `x-generate` (neither the resulting raw
  nor view entity retained it), which would have made `generate.py` skip `<Child>BridgeGrid.tsx`
  generation for any Stage-4 schema combining `x-bridge` with `x-generate`; `x-bridge` is now
  carried onto the raw entity like `x-display` and the other entity-level annotations, and
  `generate.py`'s own `BridgeGrid.tsx` emission now reads the raw entity via `_raw_def()` instead
  of the view entity directly. No consumer of this generator currently combines `x-bridge` with
  `x-generate`, so this had not yet surfaced as a build failure. See `docs/knowledge/cleanup.md`
  and `docs/knowledge/schema-restructuring-build-order.md`.

### Added
- **`x-server-value` now supports actor delegation** (extending an earlier delegation revision): a field
  declared `x-server-value: {source: actor, override_permission: <Operation>}` still defaults to
  writing the authenticated actor's id on create, but an actor holding `override_permission` (any
  `lib/authz.ts` `Operation`) may now supply an explicit value that is honored as-is — e.g. an
  admin filing a request on someone else's behalf. An actor without that permission who submits a
  value has it silently replaced with their own id rather than the request being rejected (the
  create still succeeds, just attributed to the real actor); the REST create response gains an
  optional `_server_value_overrides` flag so a caller can tell when this happened. The original
  string form `x-server-value: "actor"` is unchanged (no override capability, client value fully
  discarded). See `docs/knowledge/x-server-value-actor-delegation.md`.

### Security
- **CREATE had no read-only field enforcement at all**: PUT's existing AP-3=B rejects a
  submitted read-only field value that mismatches the persisted row, but CREATE has no row to
  compare against, so a plain `x-readonly`/`x-readonly-fields` field's client-submitted value flowed
  straight into the database on create, via both the REST route and the server action — reproduced
  against a real database before fixing. Both entry points now reject any client-submitted value
  for such a field on create outright (no legitimate fallback value the way `x-server-value` has
  actorId). `x-server-value` fields are exempted from this reject; they have their own dedicated
  resolution (see Added, above). See `docs/knowledge/x-server-value-actor-delegation.md`.

### Fixed
- **Generated Cypress test fixtures could crash or click the wrong row for entities with a
  self-referential FK**: a self-ref dependency record (e.g. a split-lineage decoy) was
  created via an unconditional `prisma.create()` in `populate{{pascal}}Dependencies()` with no
  find-or-create guard, so calling the populate helper more than once in the same spec (routine —
  once per `it()` block) duplicated the row and could trip any `@@unique` constraint the entity
  declares. The same gap existed in `populate{{pascal}}Data`/`FullData`'s own per-iteration record
  creation. Both now reuse an existing row when the entity's own `@@unique`/`@unique` columns
  resolve to a value already available in scope. Separately, `cy.contains(deps.X.name)` is
  substring-based, so a self-ref decoy sharing a name prefix with the record under test (e.g.
  "Test Sku" vs "Test Sku 2") could make a DataGrid row-lookup click the decoy instead of the new
  record; for entities with a self-referential FK, this now uses an anchored exact-match instead.
  See `docs/knowledge/self-ref-dep-fixture-unique-collision.md`.
- **`x-generate.invalidate` enabled with no handler/module produced code that could not build**
  : `actions.ts.jinja2`'s fallback branch never imported anything (a bare runtime
  `throw`), while `invalidate_action_route.ts.jinja2`'s fallback branch unconditionally imported
  a file `generate.py` never wrote — `next build` failed the moment any entity took this branch.
  This repo's only `invalidate` consumer (`user`) always supplies an explicit handler/module, so
  the branch had never actually been generated before a downstream consumer hit it. `generate.py`
  now writes a write-once stub at `lib/{entity}/invalidate_handler.ts` (same convention as the
  existing `service_after_create.ts`/`service_after_approve.ts` extension-point stubs) that both
  templates now consistently import; the stub throws a clear, actionable error until a human
  implements real invalidate logic, so no default soft-delete behavior is introduced. Also
  generalized `invalidate_action_route.ts.jinja2`'s docstring, which hardcoded `user`-specific PII
  wording. See `docs/knowledge/invalidate-no-handler-write-once-stub.md`.
- **The no-handler/module invalidate stub called `prisma.<model>.update()` unconditionally, even
  when the Prisma model has no `invalidated_at` column** (regressing the fix
  above): a later change to `invalidate_handler_stub.ts.jinja2` replaced the safe `throw` with an
  unconditional default update against an `invalidated_at` column — for any entity whose model
  lacks that column, the write-once stub no longer throws a clear error, it fails to build.
  `generate.py` now reads the entity's actual Prisma column set (via `schema_deriver.
  parse_prisma_schema`, already parsed once per run) and only emits the default update when
  `invalidated_at` is present; otherwise it falls back to the original throw. Fixture coverage
  (`code_generator/tests/fixtures/invalidate_gate`) gained a `cog` entity (no `invalidated_at`
  column) alongside `sprocket` (has the column), and
  `test_invalidate_mechanism_fixture.py` now asserts on stub file *content* for both branches —
  the earlier fixture test only checked file existence and import statements, which is why this
  regression wasn't caught.
- **Item-master entity naming was silently hardcoded to `product`/`product_id` throughout the
  ledger/split generator**: any consumer naming its item-master entity or its
  pool entity's location/lot/expiration columns differently got no error — three independent
  breaks, all traced to literal-name comparisons instead of schema-derived resolution.
  1. `helper_context()`'s `needs_second` compared a reference name (the `x-display.table` key,
     e.g. `product`) against an entity name (e.g. `item`) on mismatched axes (snake_case vs
     camelCase on top of the name mismatch), so `primary: true` silently stopped working for any
     FK primary display field whose reference name differed from its target entity name, or was
     multi-word.
  2. `generate.py`'s item-field detector compared a relation's target entity literally against
     `'product'`, always returning `None` for any other name (e.g. `item`) — this disabled the
     split-route lot/product-mismatch check with no error, and the auto-allocate WHERE clause
     silently rendered a literal `.None` (an always-undefined property access Prisma treats as
     "no item filter"), reproduced and fixed with test coverage.
  3. `generators.py`'s ledger-transaction reservation code, `split_action_route.ts.jinja2`, and
     the three `ledger_*_stub.ts.jinja2` once-stub templates hardcoded the pool entity's own
     item/location/lot/expiration column names as literal `product_id`/`location`/`location_id`/
     `lot_number`/`expiration_date`.
  All three now resolve through `x-ledger-entities.<domain>`, extended with four new **required**
  keys (no defaults — a domain missing any of them fails loudly, naming the domain and the
  missing key): `itemField`, `locationField`, `lotField`, `expirationField`. This is a breaking
  schema-config change for any existing consumer already declaring `x-ledger-entities` — it must
  add these four keys (matching its current column names) before its next `generate-code` run, or
  generation fails immediately with a named error; no generated-code content changes as a result
  of adding them alone. See `docs/knowledge/appendix/inventory-reservation-split.md` §7–8.
- **Ledger row's location column is now an id-FK, not a denormalized display string**
  (superseding an earlier design, PR #269, before either shipped in a release): that earlier design taught the
  ledger row's location write to render the pool entity's declared `x-relationship.labelField`
  into a display-string snapshot (instead of hardcoding `.name`), plus a *reverse*
  `findFirst({ where: { <labelField>: <string> } })` lookup everywhere that string needed to be
  turned back into a location row. Decided instead to hold location by id on the ledger entity too
  (matching how the item-master FK already worked) — every write is now a plain id copy
  (`ledger.location_id = pool.location_id`), and no reverse lookup exists at all, in
  `ledger_adjust_stub.ts.jinja2`, `ledger_move_stub.ts.jinja2` (×2), `ledger_write_stub.ts.jinja2`
  (forward + `afterReject` re-identification), `split_action_route.ts.jinja2` (×3), and
  `generators.py`'s reserve-phase allocation code. `resolve_ledger_domain()` no longer resolves or
  returns `location_relation`/`location_label_field`/`location_label_target` — it no longer
  inspects the pool entity's `x-relationship` declaration at all for this purpose. The FK is
  `onDelete: Restrict` (a referenced location cannot be deleted, reproduced against a real
  database); renaming a location remains possible, with `x-audit: true` (an existing,
  entity-agnostic mechanism, not new) recording who renamed it and when. See
  `docs/knowledge/appendix/inventory-reservation-split.md` §7.1–7.2 and
  `docs/knowledge/appendix/cmd562-location-id-fk-consumer-migration.md` for the consumer migration.

### Security
- **Server-action path can no longer bypass multi-stage approval ordering**: the
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
- **`npm run cleanup` could wipe every translated `messages/ja.json` entry**:
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

- **Re-submitting a rejected approval request never notified the approver**:
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
- **`check_generated.py`: new `test:unexplained-login` gate rule**: scans every
  generated `cypress/e2e/api/<entity>.cy.ts` for `cy.login(` with no `dual-auth-session-canary`
  marker comment in the 5 lines above it, so a `cy.login()` reintroduced into a future template
  edit fails `npm run check:generated` (gate step 6) instead of silently reintroducing the
  screen-operation coupling this same cmd removed. Deliberately not allowlist-exemptable like the
  existing `raw:*`/`write:direct` rules — the exemption has to be the in-file marker, checkable in
  the same diff that adds the `cy.login()` call, not a separate YAML entry a reviewer has to go
  find (the same reasoning as before: an exemption nothing checks is a hole, not a safeguard). Verified with a fault-injection test
  (added an unmarked `cy.login()` to a generated spec, confirmed the gate caught it, reverted) per
  the established convention, plus 7 new `code_generator/tests/test_check_generated.py` cases. Scope:
  only walks generated specs for now (mirrors the existing rules' entity-driven enumeration) — the
  5 proj_b hand-written API specs and proj_c's `prj/`-owned ones are tracked separately (see the separate classification
  report) as a follow-up, not yet covered by this rule. See
  `docs/knowledge/testing-cypress.md`'s "API test / UI test boundary" section.
- **Vercel's `migrate:deploy` ran through Neon's pooled connection instead of a direct one**
  : `prisma.config.ts`'s `datasource.url` (read only by the Prisma CLI — `lib/prisma.ts`
  reads `DATABASE_URL` independently for the running app, unaffected by this file) pointed at
  `DATABASE_URL`, which on Vercel is Neon's pooled (PgBouncer transaction-mode) endpoint.
  Prisma's migration engine takes a session-scoped advisory lock across a sequence of statements,
  which a transaction-mode pooler doesn't guarantee routes to the same backend connection — a risk
  that grows with every migration added, even though nothing has broken from it yet. Fixed by
  having `prisma.config.ts` prefer a new `DIRECT_URL` env var when set, falling back to
  `DATABASE_URL` everywhere it isn't (GCP Cloud Run and local/CI already connect directly, no
  pooler in front of `DATABASE_URL` there — unchanged). Deliberately not Prisma's classic
  `directUrl` datasource field: confirmed empirically that this project's Prisma config API
  (`@prisma/config` 7.9.1) doesn't have one (`tsc` rejects it with `TS2353`), and `schema.prisma`'s
  own `datasource db` block carries no `url` at all in Prisma 7 — the connection string lives only
  in `prisma.config.ts`. To keep an unset `DIRECT_URL` from silently regressing back to the pooled
  path on Vercel specifically, config loading now throws if Vercel's own auto-injected `VERCEL` env
  var is set and `DIRECT_URL` is not — everywhere else the fallback stays silent because there's
  nothing to route around. Consuming projects (`app-template`, `inventory-app`) pick this up via
  their `app-generator` submodule pointer — neither carries its own copy of `prisma.config.ts`.
  See `docs/knowledge/prisma-direct-vs-pooled-connection.md`.
- `docs/knowledge/prisma-direct-vs-pooled-connection.md`'s "Setting `DIRECT_URL` on Vercel" section
  is corrected in a follow-up: it originally described a manual, dashboard-only step. `DIRECT_URL`
  is now injected by `app-template`'s `scripts/vercel-env.sh` alongside every other Vercel env var —
  see that repo's CHANGELOG for the actual injection change.
- **The `sameEntityField` generator mechanism replaced with a hand-written validation socket
  — the business condition ("same-`entity_name`" for `approval_flow`'s `preceded_by`/`followed_by`)
  no longer lives in `json_schema.yaml` or a `*.jinja2` template** (correcting an earlier generalization:
  reviewed as a case of a coincidental business rule being generalized into the schema, when a
  future self-ref relation could need an entirely different condition). Removed entirely:
  `x-relationships.<rel>.sameEntityField` (`json_schema.yaml`), its `validate.py` checks, its
  `code_generator/validation_context.py` `same_entity_checks` list, and the generated
  `validateSameEntityRefs()` function `code_generator/templates/service_validation.ts.jinja2` used
  to emit. In its place, two purely structural (schema-free) generator changes provide a socket:
  (1) `code_generator/templates/service_validation.ts.jinja2` now unconditionally imports and calls
  a new write-once stub, `lib/{entity}/service_validation_custom.ts`
  (`code_generator/templates/service_validation_custom_stub.ts.jinja2`, same GENERATED-ONCE
  skip-if-exists convention as `autocomplete_filter.ts`) — every entity gets this call, regardless
  of whether it needs custom validation; `code_generator/build_context.py`'s `validation_data_obj`
  now unconditionally exposes every connect-style child's selected id array so a hand-written hook
  can read any child selection it needs; (2) `code_generator/generators.py`'s
  `form_upsert_context()` now unconditionally splices every field with a live `useState` variable
  onto a self-referential child's search `formValues` (previously limited to the one field named by
  `sameEntityField`) — the generator no longer decides which field (if any) a hand-written filter
  cares about. `approval_flow`'s actual same-`entity_name` rule is now entirely hand-written: the
  existing `isCrossEntityRef()` predicate in `lib/approval_flow/autocomplete_filter.ts` (GENERATED
  ONCE, unchanged) plus a new `lib/approval_flow/service_validation_custom.ts` (GENERATED ONCE) that
  calls it as the save-time backstop. Also reverts `code_generator/generators_test.py`'s
  `match_self_entity` self-ref dependency-fixture special-casing (which that generalization had reintroduced)
  back to the pre-generalization baseline, and the matching selector precision in
  `code_generator/templates/test_spec.cy.ts.jinja2`'s self-ref autocomplete-picker branch — see
  `docs/knowledge/same-entity-validation-socket.md` (replaces
  `docs/knowledge/same-entity-field-mechanism.md`) for the full design and history.
- **Generated `parent1`-style Cypress spec (2+ DataGrid children on one parent form) intermittently
  failed with "can only scroll 1 element, you tried to scroll 2 elements", and generated
  DataGrid-child date/date-time/time edit cells rejected every typed value** (two
  independent generator-scaffold bugs found and fixed together): (1) the generated scroll-into-view
  helper's `.MuiDataGrid-virtualScroller` / `data-rowindex` selectors were unscoped, so on a form
  with multiple DataGrid children (e.g. proj_c's `parent1`, with both `parent1_child1s` and
  `parent1_child2s`) Cypress matched every grid on the page at once instead of just the target
  child's — fixed by scoping the selectors to their own grid. (2) `generators.py`'s column_def
  codegen renders every `date`/`date-time`/`time` field as MUI's built-in `type: 'dateTime'`
  DataGrid column with no `renderEditCell` override, so editing goes through the browser's native
  `datetime-local` input, which Cypress's `.type()` validates strictly as ISO `YYYY-MM-DDThh:mm`
  — but the generated test scaffold's `fillDataGridRow` entries reused the human-readable
  `MM/DD/YYYY` value the top-level form's `DateTimeWrapper` accepts, and even after ISO-formatting
  that value, `editDataGridCell`'s `{selectall}`-prefix convention (needed for text/number cells)
  still failed the same strict `.type()` validation on a datetime-local input. Fixed with a new
  `_child_datetime_iso_value()` helper plus routing ISO-formatted values through `.clear().type()`
  instead of the `{selectall}` pattern (text/number cells unchanged). Verified end-to-end in an
  isolated proj_c worktree, both individually and combined with the sibling org-null fix above:
  `parent1.cy.ts` 15/15 passing; `code_generator` pytest suite 1220 passed, 1 skipped
  (pre-existing, unrelated), 0 failed. A repo-wide grep confirmed the underlying generator defect
  is generic (any project could hit it with a future date-typed DataGrid-child field) even though
  only proj_c's `parent1` currently exercises it (proj_b/proj_g's only DataGrid children have
  text-only fields).
- **Generated test helper's primary-FK-dep and own-record find-or-create removed; each `populate*Data`/`populate*FullData` call now gets a fully isolated slice of the primary FK dep's namespace** (Option β / Phase 2): closes the collision the Phase 1 letter-indexed fix (above) deliberately left open — `populate*Data(n)`/`populate*FullData(n)` called more than once in the same test (same DB session, no `db:reset` in between) could have their per-iteration primary-FK-dep row (`record_lookup_where`'s guard) and the primary FK dep's own row (`primary_fk_dep`'s `lookup_where_unique` guard) found-and-reused across calls, silently entangling two logically independent test scenarios into sharing one FK target row. Both find-or-creates in `test_helper.ts.jinja2` are now unconditional `create()`s. To keep the second call from tripping `@unique` on the primary FK dep's own required fields, a per-entity monotonic `callIndex` (module-scope counter shared by `populate*Data`/`populate*FullData`, persists for the life of the Cypress plugin process) is spliced into the loop value: `` `Test {Title} ${i}` `` → `` `Test {Title} ${callIndex}_${i}` ``. `callIndex` is always `0` for a generated spec's own calls (each `it()` calls a given populate helper at most once), so generated fixtures are unaffected in form beyond the literal string; the isolation matters for hand-written specs (or composite helpers) that call the same populate function more than once in one test. `record_lookup_where`'s own computation, and the now-fully-dead `lookup_where_unique`, are removed from `code_generator/generators_test.py`. D∩L=∅ (the Phase 1 invariant) is preserved — callIndex-shifted loop values still start with a digit, still disjoint from the letter-suffixed shared dep values. See `docs/knowledge/cmd614-test-data-uniqueness-design.md` §4.4.
- **Generated test helper dep records now use a letter-indexed name suffix(`'Test {Title} A'`/`'Test {Title} B'`) instead of `'Test {Title}'`/`'Test {Title} 2'`** (Phase 1): 
  the old dep naming collided byte-for-byte with `populate*Data(n)`'s loop rows (`` `Test {Title} ${i}` ``)
  once a loop reached `i=2`, causing find-or-create to resolve both to the same DB row. Letters and 
  digits are disjoint at the first differing byte, so the dep and loop namespaces can never intersect. 
  `_get_dep_populate_fields()`/`_get_dep_extra_required_fields()` in `code_generator/generators_test.py` 
  updated across every value branch; `prisma_val_unique` (loop values) unchanged. 
  See `docs/knowledge/cmd614-test-data-uniqueness-design.md` §3.
- **`exactRe()` exact-match test helper widened from 2 self-referential entities to all entities;
  the two post-render cleanup helpers it exposed gaps in are now anchored on code structure
  instead of comment prose, and fail loudly instead of silently no-op'ing**:
  `test_spec.cy.ts.jinja2`'s `exactRe()` regex matcher (added earlier to stop a self-ref
  decoy record's display name from substring-colliding with the record a spec creates) was gated
  behind `has_self_ref_deps`, reaching only 2 of proj_c's 46 generated specs even though the
  underlying `cy.contains()` substring problem isn't specific to self-referential deps — removed
  the gate from the function definition and all 8 call sites. Two follow-on issues surfaced only
  by verifying against proj_c's real schema: (1) an unscoped `cy.contains(exactRe(...))` can match
  the header nav's own logged-in-user badge when a dependency's display name equals it (e.g.
  `leave_request`'s `user` FK); fixed by scoping every call site to `cy.contains('.MuiDataGrid-cell',
  exactRe(...))` — narrow enough to exclude the header, still specific enough for an exact-match
  regex to match a single field's value rather than a whole row's concatenated text. (2) Widening
  the gate also rewrote the comment above `exactRe()`, silently desyncing an earlier cleanup helper's
  `_strip_unused_exact_re_helper()` — its regex was anchored on that exact comment text, so the
  "strip if unused" cleanup would have quietly stopped firing with no error and no test failure.
  Re-anchored on the function signature instead, and it now raises when its input contains the
  signature but the surrounding shape doesn't match, rather than returning the input unchanged.
  The same latent-gap shape existed in `_prefix_unused_then_callback_params()`'s
  `_THEN_CALLBACK_RE`: it matched only the exact literal spelling `.then((x) => {` — no `async`,
  no whitespace variance, and no TS type annotation, so every `.then((res: any) => {` in
  `test_reservation_spec.cy.ts.jinja2` had passed through unprocessed since that helper landed.
  Widened to tolerate that real variance while preserving the matched text verbatim, and added
  `_check_then_callback_coverage()` so any `.then(` shape it doesn't recognize fails generation
  loudly instead of shipping unprocessed. 10 new regression tests added to
  `test_generated_dead_code_postprocess.py` (19 total, all passing). Verified end-to-end: `lint`
  warning count on this branch matches the `develop` baseline exactly (5 warnings, both before and
  after), and proj_c's full API + UI Cypress suites (57 + 86 specs) reproduce the same pre-existing,
  unrelated failures before and after this change — zero new failures from any of the above.
- **`npm run lint` Completion gate step reordered to run before `generate-code`**:
  CI's `Lint` job never runs `generate-code` (`npm ci && npm run lint` only), but four
  `.claude/commands/*.md` gates (`update-generator`, `generate-schema`, `update-code`,
  `add-component`) ran `npm run lint` *after* a step that triggers `generate-code`, linting a
  much larger, uncalibrated file population (~230 additional generated files) than CI ever
  checks. This was mistaken for a 15→93 warning regression between commits (investigated
  separately) — independent re-measurement found no such regression: the post-generate-code count
  was already 93 at the exact commit (`c10b1b1a`, 2026-08-04) the "15" ceiling was calibrated
  against; "15" was itself the pre-generate-code count for that same commit, byte-for-byte
  matching the original per-rule breakdown from that earlier measurement. `npm run lint` is now the first Completion
  gate step in all four affected files (and `AGENTS.md`'s generated-code-prerequisites rule is
  corrected to name it as the one exception), guaranteeing local and CI report the same number.
  See `docs/knowledge/lint-gate-must-match-ci-precondition.md`.
- **`cypress/support/db-helpers.ts`/`generated-tasks.ts` were stale, missing `personal_note`**
  : these committed, generator-written files predate the `personal_note` entity
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
- **FK autocomplete search now derives from `labelField`, `searchField` retired**: the
  generated `search{Entity}Options` getter's cross-relation substring match (e.g. searching
  `booking` also matching on `resource.name`) used to require a separate
  `x-relationship.searchField` declaration, independent of the `labelField` that actually
  renders on screen — nothing stopped the two from drifting apart. `searchField` is removed;
  `derive_searchable_relation_fields()` (`helpers/schema_helpers.py`) now derives the same
  `{relation, field}` list from `labelField` itself, sharing its origin with the CSV-import
  full-match (`build_label_expression`), so the searched field and the displayed field can never
  disagree. Only string-typed, non-dotted `labelField` elements qualify — enum (translated
  on-screen label vs. untranslated stored value, the same trap seen elsewhere), date/time, number, and
  CUID-pattern id fields are excluded, and a composite `labelField` is evaluated per element.
  `validate.py` now rejects any schema that still declares `searchField` by name. See
  `docs/knowledge/schema-yaml-configuration.md` §5 ("`labelField` is also the autocomplete
  search source").
- **CSV import for composite/dotted labelField FK columns**: a FK relation whose
  display label is composite (`[product.name, location.name]`) or a single dotted path used to be
  export-only — there was no single scalar to resolve a CSV cell back to, so the column landed in
  `UNIMPORTABLE_COLUMN`. It is now resolved by matching the CSV cell against the full rendered
  label text, via a lookup map built once per import (not per row) from the same label-building
  helper the export getter already uses, so export and import can never disagree on what a label
  looks like. Ambiguous labels (two rows sharing the same rendered text) are rejected at row
  granularity (`MULTI_MATCH`, naming the column/value/match-count), not for the whole CSV. See
  `docs/knowledge/csv-import-composite-labelfield.md`.
- **`x-self-only`: permission-independent per-user data isolation, Stage 1**: a new
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
- **Post-login redirect-back with open-redirect protection**: unauthenticated
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
- **`@mention` server-side support** (server side of a two-part feature —
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
- **`@mention` client UI** (client side of the two-part feature above): new
  always-present `MentionInput`/`MentionText` components (`components/_standard/`) — an
  `@`-triggered candidate picker inserting `@[user_id:<id>]` markers, and a renderer that turns
  them into profile links or plain chips depending on the viewer's `canViewUserProfile`.
  `MentionInput` wires into any entity's own `x-mention: true` field on its edit form
  (`mention_fields`); `MentionText` wires into the comment display when `comment_has_mention`,
  via a new `renderMessage` render-prop on `CommentListWrapper`. Fixed a latent conflict this
  exposed: the shared comment getter was already decoding `@[user_id:<id>]` to a plain name
  server-side (pre-dating the mention feature), which left no id for `MentionText` to link — decoding moved to
  the REST API route only (keeping its JSON contract unchanged), while the page/FormView path now
  gets the raw text plus a `mentionUserContext` id→name map. Also fixed: `context.py` (the
  `types.ts.jinja2`-only context builder) never normalized either x-bridge form before detecting
  one-to-one relations, so bridge-based comment threads were invisible to it — now mirrors
  `build_context.py`'s normalization. See `docs/knowledge/mention-system.md`.
- **`@mention` comment-compose picker wiring**: the "write a comment"/edit-comment
  textareas inside `CommentListWrapper` now use `MentionInput` — typing `@` opens real candidate
  suggestions — instead of a plain `TextField`, completing the client-UI scope the mention feature explicitly
  deferred. `form_upsert.tsx.jinja2` now passes `searchMentionUserOptions` down and threads
  `canViewUserProfile`/`mentionUserContext` to the edit page (previously wired only for the
  read-only `form_view.tsx.jinja2` path). See `docs/knowledge/mention-system.md`.
- **Generated permission-denial and cross-org isolation API tests** (batch A): every
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
  : `getters.ts.jinja2` and `api_detail_route.ts.jinja2` read
  `c.creator_id` in both places that collect comment authors for
  `mentionUserContext`, but the comment type only ever declares
  `creator?: { id, name, image }` — a TypeScript compile error on any
  schema whose `comment_has_mention` branch actually renders (this repo's
  own schema never does, which is why the mandatory gate never caught
  it). Both loops now read `c.creator?.id`, matching the type; verified
  safe because `build_context.py` unconditionally includes the `creator`
  relation on every comment fetch that can reach these loops. See
  `docs/knowledge/mention-system.md`.
- **`searchMentionUserOptions()`'s permission-denied flag never reached the client**:
  the function returned an array with an ad-hoc `permissionDenied` property
  (`Object.assign([], { permissionDenied: true })`). Next.js Server Actions serialize return
  values through the RSC "flight" protocol, which — like `JSON.stringify` — only preserves an
  array's indexed elements, so the flag was silently dropped in transit and the picker's
  "suggestions unavailable" message never rendered even though the server correctly computed the
  denial. A component-level unit test couldn't catch this, since it calls the function in-process
  with no serialization boundary to cross. Contract changed to a plain
  `{ options, permissionDenied }` object. The identical pattern in `getters.ts.jinja2`'s
  `searchXxxOptions()` is presumed to share this bug and was **not** fixed here —
  flagged for a follow-up cmd. Also fixed: `generators_test.py`'s `comment_has_mention`
  test-generation gate missed the commentable one-to-one bridge form, so any entity using that
  (recommended) pattern silently got zero generated mention-UI test coverage; and `lib/prisma.ts`'s
  dynamic `import('@prisma/adapter-pg')` — which made client init depend on a top-level `await` —
  broke any Cypress Node task that transitively imports it, since Cypress's esbuild CJS bundling
  rejects top-level await outright. Switched to a static import (already the established pattern in
  `cypress/support/db-helpers.ts`). See `docs/knowledge/mention-system.md`.
- **Multi-stage approval chains never notified the next approver when their
  turn arrived**: a `preceded_by` chain creates every flow's
  `approval_request` up front, and every flow's approver role is notified
  once at that point — but a follow-on flow isn't actually actionable until
  its preceding flow(s) are approved, and nothing told those approvers when
  that moment came; they only found out by checking back themselves.
  `approveApprovalRequest()` (both independent implementations — the server
  action and the REST route) now sends a new
  `approval_order_reached` notification, distinct from the creation-time
  one, to any follow-on flow's approvers once its ordering constraint is
  satisfied. See `docs/knowledge/notification-triggers.md` "Approval
  order-reached notification".

### Security
- **Enforce MFA on the Google OAuth sign-in path** — previously,
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
  — `MOCK_GOOGLE_OAUTH_TEST=true` alone previously let anyone who
  knows a user's email sign in as them with no password/MFA check, if the
  flag ever leaked into a real deploy's env vars. Registering the mock
  provider now additionally requires a filesystem sentinel file that only
  the e2e test harness writes (`scripts/write-mock-oauth-sentinel.js`),
  never any real build/deploy pipeline; fails closed (throws at startup) if
  the flag is set without it. See `docs/knowledge/authentication.md`
  "MFA on the OAuth path" → "Testing without real Google credentials".

### Fixed
- **CSV import dotted-FK org filter gap** (security): a dotted `x-import-key` lookup
  (e.g. `role.name`) on an organization-scoped entity's CSV import route was not itself
  organization-filtered — a same-named row owned by a different organization could resolve and
  get linked to the importing actor's record. The dotted-FK lookup is now org-filtered whenever
  its *target* entity has `organization_id`, independently of the parent entity's own scoping;
  system-global lookup targets (e.g. `role`, no `organization_id`) are correctly left unfiltered.
  Covers both CREATE and UPDATE (shared resolution path); export was already correctly scoped.
  Template-layer change only, no Prisma schema change — regenerate to pick it up, no migration
  needed. See `docs/knowledge/csv-import-dotted-fk-org-filter.md`.
- **CSV import silently dropped screen-editable FK columns not declared in `x-import-key`**
  : an FK relation editable on screen (e.g. `approval_flow.requestor_role`) but absent
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
- **Dependabot `target-branch: develop` never took effect**: Dependabot always reads
  `.github/dependabot.yml` from the default branch, not `develop`, so `develop`'s copy of the
  setting was inert; ported to `main`'s copy (PR #248). See
  `docs/knowledge/dependabot-config-read-from-default-branch.md`.
- **MUI major-update PRs grouped into one; missing Dependabot labels created**: added
  an `npm-mui-major` group to `.github/dependabot.yml` (PR #256, the copy on `main` that
  Dependabot reads) so major-version bumps across the whole `@mui/*` scope land as one PR
  instead of one per package. Also created the `dependencies`/`npm`/`python`/`github-actions`
  repo labels that Dependabot's config referenced but that never existed, so future PRs stop
  reporting a missing-label warning.
- **fast-uri HIGH CVE (GHSA-7p8r-x3mc-p8w7) blocking the Dependency Audit gate**:
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
- **`x-approval.set_fields` docs contradicted the implementation**: `docs/knowledge/appendix/approval-flow.md`
  §16.9 showed `on_approved.set_fields` as a list-of-`{field, value}` entries, contradicting
  §16.11's mapping form and the only shape `_resolve_set_fields()` (`code_generator/generate.py:289`)
  accepts (it iterates `raw.items()`). A schema author following §16.9 as written hit an
  uninformative `AttributeError` deep inside `generate()`. Fixed the doc example to mapping form
  and added `validate_schema()` Section 10 (`code_generator/validate.py`) to reject a non-mapping
  `set_fields` before generation runs, naming the entity, the offending field key(s), and the
  correct form.
- **`npm run lint` now enforces a warning ceiling** (`eslint --max-warnings 20`, follow-up to
  an earlier fix): a prior triage found 216 unused-vars/expressions warnings had silently accumulated
  behind a config gap, one of which was a genuine dead branch — a ceiling that only ratchets down
  (never silently raised) stops that from recurring unnoticed. Seeded 5 warnings above the
  measured `develop`-tip count (15) rather than an exact match, so one incidental warning doesn't
  turn an unrelated PR red. See `docs/knowledge/lint-warning-ceiling-ratchet.md`.
- **`components/*/form_validation.ts` untracked from version control** (follow-up):
  `.gitignore` negated this generated file as if it were a customizable stub, but `generate.py`
  writes it via the unconditional-overwrite `_write()` (not `_write_stub()`), and its template has
  never had a customization marker even at the file's original commit — so tracking it in git gave
  a false impression of preservable hand-edits while the generator silently clobbered them every
  run. Removed the negation and untracked all 8 previously-committed instances; verified a full
  delete + `generate-code` + `tsc --noEmit` + `check:generated` cycle reproduces them identically
  with nothing else affected.
- **cypress excluded from routine `npm-minor-and-patch` bumps**:
  cypress 15.16.0 → 15.19.0 alone (isolated via a single-variable control
  experiment) broke `dashboard.cy.ts`'s DataGrid cell lookup, unrelated to
  the product code or any MUI package. `.github/dependabot.yml` (`main` and
  `develop` copies) now excludes cypress from grouping and ignores its
  routine minor/patch bumps; security-update PRs are unaffected. See
  `docs/knowledge/testing-cypress.md` ("Cypress version held back").
- **`receiving_confirm_route.ts.jinja2` deleted — orphaned since an earlier removal**: the RC-1
  ruling (2026-07-13, `docs/knowledge/appendix/inventory-domain-generalization-design.md` §4.5)
  abolished `x-receiving` and stated `ReceivingConfirmForm.tsx` + the confirm route were "deleted,
  no replacement." In practice only `ReceivingConfirmForm.tsx` and its `generate.py` call site were
  removed at the time; the route template itself was never wired into `generate.py` to begin with
  (git history: both files were added together in the same original commit, `1cebe8ed`, alongside
  the unrelated `x-reservation.actions` ship/release/cancel feature) and was never referenced by any
  `_render()`/`_write()` call — an unused, dead file from day one. Confirmed no equivalent leftover
  for ship/release/cancel: `x-reservation.actions` (the feature that originally shipped
  `reservation_actions.ts.jinja2`) was already fully removed in that earlier change, template included.
  Repo-wide grep for `receiving_confirm`/`ReceivingConfirmForm` across `code_generator/`,
  `json_schema.yaml`/`json_schema_internal.yaml`, and both consumer submodule checkouts
  (`app-template`, `app-template-4`) returns zero hits after this change.
- **Generated-test Decimal values were a fixed literal, overflowing narrow `@db.Decimal(p, s)` columns**:
  every Decimal test-value call site in `code_generator/generators_test.py` (`prisma_value`,
  `cypress_create_value`, `cypress_edit_value`, `api_value`, `_get_dep_populate_fields`,
  `_get_dep_extra_required_fields`) planted the same fixed literal (`'10.00'`, `'150.00'`,
  `'250.00'`, ...) regardless of the column's declared precision/scale. A narrow column such as
  `Decimal(5, 4)` rejected `'10.00'` outright with a Postgres "numeric field overflow", taking
  every other generated test in the same spec file down with it — discovered via a real schema
  with 36 tests failing this way. Values are now derived from the column's own `x-decimal-scale` /
  `x-decimal-precision` (`schema_deriver.py`, auto-reflected from the Prisma schema), including
  the all-fractional edge case (`Decimal(4, 4)`, no headroom for a nonzero integer digit).
  Verified against a real Postgres `numeric(5,4)` column that the old literal reproduces the
  reported overflow and the new derived value inserts successfully.

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
