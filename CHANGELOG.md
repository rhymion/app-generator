# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [Unreleased]
### Added
- **List search box over trigram columns, `x-trigram-filter`** (Issue #1051). An entity that is a cross-entity search
  target now has a search box on its list that matches its search trigram columns (the union of `text_fields` and
  `bigm_fields`) as a case-insensitive substring, served by the existing `_v2` COALESCE trigram indexes. The new
  column-level boolean `x-trigram-filter`, set on the column's entry under `properties:`, overrides it: `true` adds a column (also on an entity that
  is not a search target) and indexes it, `false` removes it from the box. An entity that is not a search target and declares
  nothing is unchanged. The list's `search` parameter and the `listQuery.searchKeys` spec replace the title-column
  `searchKey`. See `docs/knowledge/list-panel-trigram-filter.md`.

### Changed
- **`anonymizeUser()` erases the related records of the erased person and keeps the first erasure time** (Issue #1062). In the
  same transaction it now deletes the avatar `attachment` row (when `image_id` is an `x-pii` column), sets
  `mobile_session.device_name` to `null`, and deletes the person's `notification` and `idempotency_key` rows; after the
  commit it removes the stored avatar file (local disk, Vercel Blob or GCS), reporting a failure in `errors` without undoing
  the erasure. A repeated call keeps the first `anonymized_at` / `invalidated_at` and cleans up what an earlier call left.
  No new schema key and no migration. Output of `lib/compliance/anonymize_user.ts` changes. See `docs/knowledge/x-pii.md`.
- **An entity's columns and relations share one `properties:` map, and a proxy view names its model with `x-view-of`** (Issue #1065).
  The entity-level `fields:` key is removed. Scalar and enum columns, relation objects and relation arrays are all entries
  of `properties:`; the builder classifies each by the Prisma field kind of its name, so a column keeps its written order
  and an explicit `<x>_id` still wins over the automatically completed foreign key. A name Prisma does not have, and a
  leftover `fields:` key, are build errors. A proxy view is written `x-view-of: <model>` (the only new key); `allOf` is no
  longer written in a user schema. The built intermediate schema is unchanged, so generated output is identical.
  `code_generator/migrate_fields_into_properties.py` rewrites an existing schema, and `convert_to_user_schema.py` emits the
  new form. See `docs/knowledge/schema-yaml-configuration.md`.
- **The `version_of_e2e_gate` fixture covers an `x-version-of` identity with a virtual primary column and `x-generate.test: true`** (Issue #1049). 
  The new `vo_page` / `vo_page_version` pair is built and run by `npm run test:version-of-e2e-gate`, including its generated UI and 
  API specs. This exposed that the paired version was never created for such an identity in a real generated schema: the 
  pairing required the identity to list `current_version_id` among its properties, which x-version-of does not add. The 
  requirement is removed, so `populate<Identity>Data()` now creates the version and makes it current. No new schema key.
- **`x-pii`, `x-retention` and `x-gdpr-mode` are documented against the generator's actual behavior.** Only `x-pii` on the
  `user` entity changes generated code (the field set `anonymizeUser()` scrubs); `x-gdpr-mode` is validated and `x-retention`
  is unchecked, and neither affects any generated file. The README entries and support table say so. See
  `docs/knowledge/x-pii.md` and `docs/knowledge/x-gdpr-mode.md`.
- **Generated autocomplete search resolves a two-hop `labelField`** (Issue #1050). `labelField: test_case_version.title` 
  on a foreign key to an entity that points at a version used to be skipped, so the picker returned no option for any text. 
  One extra hop through the target's own foreign key is now rendered as a two-level nested `where`; longer paths and paths 
  whose first segment is not a foreign key of the target stay excluded. No new schema key. See 
  `docs/knowledge/label-field-search-semantics.md`.
- **Generated UI spec and helper for an `x-version-of` identity with a virtual primary column** (Issue #1049). 
  `populate<Identity>Data()` and `populate<Identity>FullData()` now create a paired version per row (its primary column set 
  to `<Title> <n>`) and make it the identity's current version, so the list assertions hold. A row created through the form 
  has no version yet, so the create examples assert the row instead of a name and the primary-edit and view-field assertions 
  are skipped. An optional foreign key that closes a required cycle (the identity's `current_version_id`) is left out of the 
  create and edit form steps, matching the dependencies the helper creates. No new schema key.
- **An `x-version-of` identity's detail screen links to the new version screen** (Issue #968). The Version history section 
  now has a **New version** button that opens `/<version>/new?new_version_of=<id>`. It is shown only when the caller may 
  create the version entity and the identity has a current version. `get<Version>VersionHistory` also returns 
  `canCreateVersion`, and the `VersionHistory` messages gain `newVersion`. No new schema key.
- **The task-runner image skips the Next.js build** (Issue #1036). The generated `Dockerfile` has a new `task-runner` 
  stage (dependencies, `generate-code`, `prisma generate`) and the `builder` stage now extends it with `npm run build`, so 
  the migrate image used by `gcp-deploy.sh` is unchanged. `scripts/gcp-task-runner.sh` builds `--target task-runner` by 
  default (`TASK_RUNNER_DOCKER_TARGET=builder` restores the previous image). No new schema key. Build time and image size 
  are in `docs/knowledge/scheduled-task-operations.md`.
- **The business date comes from `app_setting`** (Issue #1037). `is_pinned: true` uses the stored `business_date`;
  `is_pinned: false` uses today's date in the row's `timezone`; with no row the date is today in UTC. One resolver
  (`lib/business-date.ts`, `getBusinessContext()`) serves every caller: the tenant-wide default row for scheduled tasks
  and the scheduled-task admin page and REST route, an organization's own row first for callers that pass an
  organization. The generated run guard (`businessDateOf()`, now async), `task:run-all` and its `not_due` check read
  it instead of the UTC clock, and a task's cron `interval` is evaluated in the same time zone.
  `app_setting.business_date` is now optional (`String?`): required (a real `YYYY-MM-DD` date) while `is_pinned` is
  true and not read while it is false (no empty check), enforced by `lib/app_setting/service_validation_custom.ts`. While a date is pinned
  it does not advance, so a daily task reports `already_succeeded` from the second night until the date is changed.
  `scripts/seed-baseline.ts` writes the default row without a date. Existing databases run
  `scripts/migrations/06_app_setting_business_date_optional.sql` once (nullable column, unpinned rows cleared;
  `npm run test:business-date-migration` checks it against the previous schema).
  A list primary field may now be a column that has a default, since such a column is never empty (`validate.py`).
  The generated API/UI specs follow: a defaulted primary column is populated and sent like a required one, and a `*_date` text column
  gets real `YYYY-MM-DD` sample values.
- **`prj:sync` removes the old copy of a file renamed or deleted in `prj/`** (Issue #619). The script now records the files it copies verbatim in a gitignored `.prj-sync-manifest.json` and, on the next run, removes a recorded destination whose `prj/` source is gone, so a renamed route no longer leaves a stale twin that breaks the type check. A destination changed since the sync is kept with a warning; files the sync never copied, `messages/*.json` and everything when `../prj` is absent are never removed. No new schema key. See `docs/knowledge/prj-sync-stale-file-removal.md`.
- **`vercel-setup.sh` reconciles the project Function Region** (Issue #589). Step 1.5 already set the Root Directory; it now also reads `serverlessFunctionRegion` through the Vercel Projects API and PATCHes it to the first `regions` entry of the committed `app-generator/vercel.json` when it differs (a new project starts on `iad1`). A project already on that region is left untouched, `DRY_RUN=true` only echoes the calls, and a missing `regions` entry skips the step. The token is passed to `curl` on stdin, not in argv. No `vercel.json` change and no schema key.
- **Generated resubmit API examples omit read-only fields from the PUT body** (Issue #1046). The `14.3` and `14.5` examples sent a read-only field (for example a version number assigned on approval) with the value read before approval, so the route answered `400` instead of the expected lockdown `403`. The body now leaves read-only fields out, as the read-only preservation example already does; other examples and entities without read-only fields are unchanged. No new schema key.
- **Generated API specs skip the per-entity search example when the seed grant denies read** (Issue #1044). An entity whose `SEED_ENTITY_GRANTS` read grant is false (neither `x-generate.list` nor `x-generate.view`) can never surface rows for the test API user, so the `N10` example is no longer emitted for it. Entities with either page keep it. No new schema key.
- **Autocomplete search for an `x-version-of` identity also matches the row id** (Issue #1042). The generated `search<Identity>Options` matched only the identity's current-version columns, so an identity without a current version (and a version form's parent picker that shows the identity id) could never be found. The id is now one more `OR` alternative per search token; existing matches and entities that are not identities are unchanged. No new schema key. The generated view-page assertion for a foreign key labelled by `id` now expects the value the autocomplete was filled with instead of a fixed title.
- **DataGrid date and date-time columns use MUI pickers** (Issue #764). The list-page filter value and the filter and edit cell of an embedded child grid for every `date` / `date-time` column now use MUI `DatePicker` / `DateTimePicker` instead of the browser's native date inputs, so the calendar follows the app locale (en/ja) rather than the browser's UI language. Filter values, saved values and time zones are unchanged. No new dependency and no schema key. `editDataGridCell()` in `cypress/support/datagrid-helpers.ts` types the same ISO values into the picker. See `docs/knowledge/i18n-locale-routing.md`.

### Added
- **Mobile search results open the record and use translated text** (Issue #870, part of #140). A result on the Search
  screen opens the record's detail screen when the entity has one (the entity list otherwise); a result for an entity with
  no native screens is marked "Not available in the app" and does not navigate. The screen text comes from the new `Search`
  namespace of `messages/<locale>.json`, entity names from `EntityLabel`, and snippet match markers render in bold.
- **Dockerfile and `.dockerignore` for scheduled tasks on any provider** (Issue #1029). `generate-code` writes both files
  whenever the schema declares `x-scheduled-task` or `x-scheduled-tasks`, independent of `x-cloud.provider`, so
  `scripts/gcp-task-runner.sh` Step 5 works for an app deployed on Vercel. `x-cloud:gcp` keeps its other behavior
  (GCS upload route, `output: 'standalone'`, no `vercel.json` crons). No new schema key.
- **Dashboard text and chart labels are translated** (Issue #913). Widget subtitles, "No data", "No widgets yet", the
  CSV button and CSV headings use `messages/<locale>.json` (new `DashboardView` section, en and ja). Chart categories
  and series show the same labels as lists and forms: enum option labels (the dashboard catalog now carries
  `enum_namespace`), Yes / No, and the `(unspecified)` / `(unknown)` / `(unnamed)` placeholders; entity and field
  names in the subtitle use their display labels.
- **Documentation for Chrome's phishing warning on demo logins** (Issue #724). `docs/knowledge/vercel-demo-login-phishing-warning.md`
  explains why a login page on a shared `*.vercel.app` subdomain can trigger Chrome's password-reuse warning and what to do about it
  (custom domain, a distinct `SEED_ADMIN_PASSWORD` per deployment, Safe Browsing lookup and report flow);
  `docs/knowledge/seed-baseline-credential-hardening.md` states the per-deployment password rule. No behavior change.
- **Entity-name selects offer `audit_log` and show dictionary words** (Issues #1013, #1015). A field declared with
  `x-entity-select` (`permission.name`, `approval_flow.entity_name`) now also offers `audit_log`, the system table a
  permission can name. `approval_request` and entities without generated pages stay out on purpose: they are not
  permission or approval targets. Every option has an `EntityLabel` key in every `messages/<locale>.json`, and the Web
  edit, detail and list screens and the mobile chips, list cells and detail text show that word; the stored value stays
  the entity name. Generated Cypress specs find a list row by the dictionary word.
  `docs/knowledge/entity-select-options.md` states the rule.
- **Bucket access for the task-runner Job** (Issue #1008). `scripts/gcp-task-runner.sh` accepts
  `TASK_RUNNER_BUCKET_ROLES` (space-separated `BUCKET=ROLE` pairs) and grants the Job's runtime service account a
  bucket-scoped role on each bucket; unset, nothing changes. `docs/knowledge/scheduled-task-operations.md` also states that
  every variable reaches the Job as a Secret Manager secret.
- **GCS and S3 write-once storage for audit_log digests** (Issue #991, part of #945). `lib/audit-log-integrity/storage-gcs.ts`
  stores digests and archives in a Google Cloud Storage bucket with per-object retention (unlocked or locked) and create-if-absent
  writes; the S3 Object Lock adapter moves here from the consumer template. Both load their SDK through a dynamic import with a
  literal module name, only when selected. The new opt-in key `x-generator.audit-log-storage.enabled` generates
  `lib/audit-log-ops/storage-factory.ts` (picks the storage from `AUDIT_LOG_GCS_*`, `AUDIT_LOG_S3_*` or `AUDIT_LOG_STORAGE_DIR`, and
  fails when none is set) and `lib/audit-log-ops/jobs.ts`; absent or `false` generates nothing and no generated file refers to an
  adapter. `AUDIT_LOG_GCS_AUTH=vercel-oidc` authenticates from Vercel without a key. `@aws-sdk/client-s3`, `@vercel/oidc` and `google-auth-library` are added to `dependencies`. See `docs/knowledge/audit-log-append-only.md`.
- **Native end-to-end flows for the Expo app** (Issue #994, part of #140). `generate-code` writes one Maestro flow per entity
  that has native screens to `mobile/e2e/generated/maestro/` (git-ignored), from the same decision that emits the screens: sign
  in, open the list from the footer tabs, check the list, open the first row's detail screen, and create one record for an entity
  whose required fields are simple. `scripts/run_mobile_native_e2e.sh` validates the flows with `maestro check-syntax` and, with
  an APK and an attached Android device or emulator, runs them; it exits with status 3 (`UNAVAILABLE`) rather than passing when
  the CLI, adb, the APK or a device is missing. `docs/knowledge/mobile-app.md` describes the flows, the entry script and the
  order in which they grow. The flows are not part of the completion gate.
- **Mobile executable guide** (Issue #987). `docs/knowledge/mobile-executable.md` documents building a release `.apk` locally 
  with `expo prebuild` and Gradle (measured), the iOS routes and what each needs, setting `EXPO_PUBLIC_API_BASE_URL` for a real 
  device, and the `app.json` / `eas.json` settings the generator does not emit. Documentation only.
- **CI changes now exercise the mobile Playwright job**. `.github/workflows/ci.yml` is on the path list in
  `scripts/mobile_pw_gate_applies.sh`, so a change to the workflow that defines the `mobile-playwright` job runs the suite instead of skipping it.
- **Scheduled tasks on GCP, in dependency order**. `docs/knowledge/scheduled-task-operations.md` explains what to
  register on GCP (one `task:run-all` Job versus one Scheduler job per task), that `task:run-all` honors `depends_on` order
  and the UTC business date but not the time of day of an `interval`, how non-daily tasks are recorded as `not_due` and how a
  missed month is recovered, how entity-level tasks are declared and ordered, how to run once by hand and read the result, and
  a local dry run with a shifted clock. `docs/knowledge/audit-log-append-only.md` states what `verify` detects and does not.
  Documentation only.
- **Mobile Playwright entry point, gate step and CI job** (Issue #985, part of #140). `npm run test:e2e:mobile:pw` now runs
  `scripts/run_mobile_entity_playwright.sh`, which runs the fixture, default and scheduled modes in turn and fails if any mode
  fails; the bare Playwright invocation is `test:e2e:mobile:pw:raw` and refuses to run unless `MOBILE_PW_PRECONDITIONS_READY=1`
  is set. The mobile specs sign in as `admin@example.com` by default (the `db:seed-baseline` administrator), the script refuses a
  symlinked `node_modules`, and `docs/knowledge/mobile-app.md` describes the three modes, the manual recipe and why app-template
  does not run these specs. The update-generator gate has a path-triggered step for the suite
  (`scripts/mobile_pw_gate_applies.sh` holds the path list) and CI has a path-filtered `mobile-playwright` job.
- **Dashboard guide, and corrected dashboard docs** (Issue #909, part of #904). `docs/knowledge/dashboard-guide.md` explains
  how a schema author opts an entity in and which fields become groupable, what each widget setting does and which
  combinations are valid, what each problem message means, how read permission and row scope apply, and the
  `POST /api/dashboard/aggregate` request, response and errors. README, README_ja and the schema reference now describe the
  one schema-wide aggregate endpoint (not a per-entity one), CSV export only (not Excel), and the full groupable-field list
  including number and date/time fields and the always-added creator, updater and timestamp fields. Documentation only.
- **Mobile: an unreachable server is explained.** The sign-in screen now catches a network failure (server down, device
  offline, or a request the browser blocked) and shows "Could not reach the server" instead of an error screen; a failed
  navigation lookup keeps the footer fail-closed but shows a notice that the menu could not be loaded, distinct from
  missing permissions. `docs/knowledge/mobile-app.md` says to open the same-origin proxy URL, not the Expo dev server's
  port. No new schema key.
- **Dashboard widgets say why they cannot be drawn** (Issue #908, part of #904). A widget that cannot render now names
  the wrong setting, why, and how to fix it, in English or Japanese, instead of showing a raw internal message or
  "Failed to load". Distinct messages cover: no data source in the schema, a data source that is not available, no read
  permission, an unknown or removed field, a time bucket or time zone on a field that is not a date/time, a stack mode
  without a series, a line chart without a bucket, and a filter value that does not fit its field; a filter matching no rows
  reads "No data matches this chart." `aggregateForWidget` returns the problem as data (`{ ok: false, problem }`) so it
  survives a production build, and `POST /api/dashboard/aggregate` answers with HTTP 400 and `{ error, code, setting,
  params }`. Saving a dashboard now rejects a widget that cannot be drawn with a field-level error (widgets saved earlier and
  left unchanged are not re-judged), and the editor shows the same messages while editing. For this, owned child rows are now
  passed to `validateCustomRules` as `data.<property_name>`, like connect-style children's ids; no existing key changes. The
  call lives in the tracked `lib/dashboard/service_validation_custom.ts`; only an app that overrides that file from `prj/` needs
  the call added by hand. No new schema
  key. See `docs/knowledge/schema-yaml-configuration.md`.
- **`scripts/check-migrations-match-schema.sh`: checks that the migrations build the schema.** On an empty local scratch
  database it runs `prisma migrate deploy` and then `prisma migrate diff` against `prisma/schema.prisma`, and fails with the
  missing SQL when they differ. This catches a generator-added model (for example `scheduled_task_run`) that a consumer has
  no migration for, which `db:push` test databases never show. It refuses any non-loopback database host, passes
  connection details through environment variables only, and reads known differences from an optional exceptions file
  (`prisma/migration-schema-exceptions.txt`, none by default). It is run when preparing a `develop` merge or a deployment,
  not per commit. No new schema key. See `docs/knowledge/migration-schema-check.md`.
- **Audit log: steps for switching the application to the restricted database role** are listed in
  `docs/knowledge/audit-log-append-only.md` (password, hand-assembled connection strings, one role per Neon branch,
  verification), and `scripts/vercel-env.sh` reminds that its `DATABASE_URL` injection is the owner's pooled URL. The
  scheduled-task documentation states that a consumer writes the migration for generator-injected models such as
  `scheduled_task_run`.
- **Dashboard widget editor: group-by and series fields are chosen from a list** (Issue #906, part of #904). `group_by_field`
  and `series_field` are dropdowns of the selected data source's fields, with translated labels and the field kind, instead of
  free text. Changing the data source clears the fields of the previous one. Options follow the chart: the time bucket only for
  a date/time group-by field, the series not for pie, the stack mode only for bar / column with a series, and a line chart groups
  by a date/time field and always has a bucket, so inapplicable combinations are corrected in the editor rather than found at
  render time. Stored values are unchanged; a stored field the data source no longer offers is flagged. No new schema key.
  See `docs/knowledge/schema-yaml-configuration.md`.
- **Dashboard widget editor: the data source is chosen from a list** (Issue #905, part of #904). The dashboard edit form no
  longer shows widgets as a grid of free-text cells; each widget is edited in a card, and `entity_name` is a dropdown of the
  `x-display.dashboard` entities the user can read, with translated labels. Stored values do not change, so existing widgets
  load as before; a stored data source that is no longer available is flagged. When no entity opts in, the editor says so and
  links to the schema documentation. To make this possible, `x-custom-component` (target `upsert`) now also works on a child
  array property: a hand-written component takes the place of the generated grid and keeps its row contract. No new schema key.
  See `docs/knowledge/code-generation-custom-extensions.md`.
- **Mobile app: insertion points for hand-written components** (Issue #873). The Expo app now reads
  `x-custom-components` (entity level: `list`, `view`, `edit`) and `x-custom-component` (field level: `upsert`, `view`) as
  they stand, with no new schema key, and mounts a native component of the same name at the position of the Web one: the
  list's search / sort / filter row, the detail screen after the built-in sections, the form after the inputs (create form
  included), and in place of a field's input or detail row. Each component gets a native stub, generated once and never
  overwritten, that renders nothing; `generate-code` lists new stubs under `ACTION REQUIRED`. Entities left on the placeholder
  screen only because of these components (in the default schema `user` and `dashboard`) now get native screens. The props
  contract is generated into `mobile/lib/custom-component.ts`. A credential field (an upsert-only string) is not listed or
  shown, and a field component is sent only once changed. `ApprovalSection` and `AttachmentSection` keep their native
  support. See `docs/knowledge/mobile-app.md` and `docs/knowledge/code-generation-custom-extensions.md`.
- **Mobile app: entities that own attachments through the `attachable` bridge get native screens** (Issue #949). An entity
  with `attachable_id` (`one-to-one_bridge` to `attachable`) and the `AttachmentSection` component is no longer left on the
  placeholder screen: the detail screen lists its images and files, and the edit form adds (system file picker), removes and
  reorders them. A new generated route, `PUT /api/<entity>/<id>/attachments`, replaces one type's attachments through the Web
  panel's own `setAttachmentsForBridge`, with the owner's `update` permission and organization checks, and refuses an id that is
  not the record's own attachment. The `showImages` / `showFiles` props decide which lists are drawn. In an app where only the
  bridge needs it, the file picker dependency is now added too. See `docs/knowledge/mobile-app.md`.
- **`x-version-of`: identity + version entities with approval-backed history** (Issue #946). Declared on the version entity
  (an `x-approval` entity), it generates the version number assigned at approval, at most one open draft per identity,
  the identity's `current_version_id`, and a terminally rejected version kept as a closed record that does not block the next version.
  The Prisma columns are declared by the app and checked at generation time. See `docs/knowledge/schema-yaml-configuration.md`
  section 7.8.
- **`x-version-of`: gate and CI cover the whole feature** (Refs #946). The `version-of-e2e-gate` fixture gate (local step 14e and the
  `version-of-e2e-gate-fixture` CI job) now documents and runs the number assignment, the one-open-draft rule, the prefilled new
  version screen and the identity tombstone; README.md / README_ja.md list the key. No generated output changes.
- **`x-version-of`: new version screen** (Refs #946). `/<version>/new?new_version_of=<identity id>` opens the version
  entity's create form filled with the current version's values, including child rows that have no screens of their own;
  nothing is saved until the user saves it. Unique columns (including required ones on child rows) are left for the user,
  and a new attachment bridge is created for the new record.
- **`x-version-of`: identity tombstone** (Refs #946). An identity with an approved version can no longer be deleted
  (retire it with `x-generate.invalidate`), and an invalidated identity takes no new draft. An identity that declares
  `x-generate.invalidate` now needs an `invalidated_at DateTime?` column, checked at generation time.
- **`x-version-of`: standard version list and two-version diff** (Issue #953). An identity with a version entity gets a
  Version history section on its detail screen that lists every readable version, drafts included, and compares any
  two of them, by default the current version against the open draft. Fields render with the detail screen's markup,
  long text gets a word diff, and owned child rows are paired by `x-import-key`, else by `order`, else shown as
  additions and removals. The reads use the version entity's own permission and organization filter. A draft's approval
  section links to the diff. No new schema key; an explicit `x-custom-components` on the identity (`[]` included) opts
  out. See `docs/knowledge/schema-yaml-configuration.md` section 7.8.
- **Mobile app: entities with a self-referencing `children` list get native screens** (Issue #942). A one-to-many
  `x-outputType: list` child attached through a nullable foreign key (for example `procedure.children`) no longer
  makes an entity ineligible: it is drawn as the same chip picker as a many-to-many list and saved as `children_ids`.
  The edit form sends the record's `id` with the picker's search so the options route leaves out the record itself and
  its ancestors; records owned by another record are not offered. See `docs/knowledge/mobile-app.md`.
- **Mobile app: entities with an `x-entity-select` field get native screens** (Issue #944). `entity_select` no longer
  makes an entity ineligible: the field is drawn as chips labelled with the entity titles, the entity name is saved,
  and the list and detail screens show the title. The mobile field spec gains `optionLabels`. In the default schema
  `approval_flow` and `permission` get mobile screens. See `docs/knowledge/mobile-app.md`.
- **Mobile app: entities that declare `x-reservation` get native screens** (Issue #937). `reservation_config` no longer
  makes an entity ineligible, so a reservation entity without a child grid (item mode, for example a room reservation)
  has list, detail, create, edit and delete screens. The generated REST routes now answer a request with no free
  capacity with `{ error, code: 'CAPACITY' }` and a locked count-mode reservation with
  `{ error, code: 'RESERVATION_LOCKED' }` (HTTP 409 as before; clients reading `error` are unaffected), so the app shows
  the same texts as the Web instead of the stale-update warning. A count-mode reservation with `lines` still stays on the
  placeholder screen because of its child grid. See `docs/knowledge/mobile-app.md`.
- **`audit_log` is append-only, with tamper detection** (Issue #945). A Prisma Client guard rejects `update`, `updateMany`,
  `upsert`, `delete` and `deleteMany` on `audit_log`; `prisma/sql/audit_log_append_only.sql` adds a row trigger that rejects
  UPDATE and DELETE, partitions the table by month and creates `audit_log_digest`; `npm run audit-log:digest` closes daily
  SHA-256 digests (chained, written to a storage interface with a local-directory implementation), verifies them, and exports a
  month for the retention procedure. `audit_log` now has the primary key `(id, created_at)` and there is a new
  `audit_log_digest` model. `npm run db:apply-audit-log-sql` runs after `db:push` in the test and setup scripts, and
  `resetTestDatabase()` empties both tables with `TRUNCATE`. Consumers add the SQL to their own migrations, create the
  restricted application role and the write-once bucket; see `docs/knowledge/audit-log-append-only.md`.
### Changed
- **The Cypress helper `grantAllEntityPermissions` grants what the real seed grants** (Issue #848). Instead of full CRUD
  and import on every entity, it reads the generated `SEED_ENTITY_GRANTS` (the source of `npm run db:grant-all-permissions`),
  so an entity with `x-generate.new: false` no longer gives the test user `create`. Entities outside that list, such as
  `labelField` targets, keep full CRUD. A spec that needs a further right adds it explicitly. See
  `docs/knowledge/grant-all-permissions-x-generate-gate.md`.
- Completion gate documents (`generate-schema`, `update-code`, `update-generator`) now name `npm run db:generate` as a prerequisite of the vitest step on a fresh checkout (Issue #1006).
- **List sort / filter panel no longer offers internal bridge foreign keys** (Issue #967). `Approvable Id`, `Attachable Id`,
  `Commentable Id` and the like are dropped from the Web panel and from the Expo list's sort and filter keys, using the
  generator's existing internal-bridge detection (no new schema key). The REST list still accepts them as sort / filter
  parameters. See `docs/knowledge/list-search-panel.md`.
- **Dashboard REST: `group_by_bucket` is the enum string literal** (Issue #912). `POST /api/dashboard/aggregate` now takes
  `day`, `week`, `month`, `quarter` or `year`, like every other native enum in the REST API, and the integer form `0`-`4` is
  removed. An unknown value returns `400` naming the allowed values instead of being ignored (which returned an unbucketed
  result). A client that sent the integers must send the literals. The built-in dashboard UI already used the literals.
- **`anonymizeUser()` no longer redacts `audit_log.metadata`** (Issue #945). `audit_log.metadata` must not contain personal
  data, so the step never changed anything, and under the trigger an update would fail the erasure transaction.
  `recordAuditEvent`'s documentation now says `metadata` must not contain personal data.
- **Auth code no longer writes email addresses to `audit_log` or to auth `console.info` lines** (Issue #935). `auth:signIn`
  and `auth:createUser` rows drop `metadata.email`; the `email_in_use_by_credentials` rejection drops it too and now
  records the existing user's id as `target_id` (`actor_user_id` stays null); `domain_not_allowed` keeps only `reason`
  and `provider`. The matching `[auth:*]` log lines no longer carry `email` / `oauthEmail`. The redaction step in
  `anonymizeUser()` is unchanged. Rows already stored keep their `metadata.email` until a consumer cleans them up.
  See `docs/knowledge/authentication.md`.
### Fixed
- **The generated Expo app type-checks, enum filter choices show their labels, and a composite `labelField` names a related record** (Issue #1077). `npm run typecheck` of the generated `mobile/` failed on every schema: each entity list passed a `FieldSpec` list where the list panel wants a `ListFieldSpec` list, and a composite `labelField` (a list of paths) was typed as a single column. Besides the type errors, the panel looked enum labels up by member in a positional array, so the filter showed the raw member, and a relation picker or read-only screen fell back to the record id for a composite label. The new `lib/label-spec.ts` converts a form field to the panel's field type and joins a composite label's paths with a space, following dotted paths, as the Web does (a date segment shows its stored text). `scripts/run_mobile_entity_playwright.sh` now runs `npm run typecheck` on the generated app in every mode. No schema key changes.
- **Generated test dependencies skip an optional FK that closes a required cycle** (Issue #1025, part of #946). An identity
  entity's nullable `current_version_id` to its version entity is no longer pre-created as a dependency of the identity:
  the version requires the identity, so the generated `populate<Entity>Dependencies()` created the version row without its
  required parent FK and the API Cypress specs failed. The generated test helper also no longer returns an alias for a dependency that was skipped.
- **`form_validation.ts` compiles for an entity with no required form field** (Issue #1026, part of #946). `REQUIRED_FIELDS`
  has an explicit element type instead of `as const`, so an empty list no longer infers the empty tuple type.
- **Generated API spec no longer expects a validation failure for an entity with no required field** (Issue #1031). The `5.1 fails when a required field is missing` and `8.2 bulk creates — partial failure when a required field is missing` examples are generated only when the entity has a required field to omit; otherwise the request is valid and the API correctly answers `201`.
- **The generated OpenAPI record schema lists `created_at`, `updated_at` and `creator_id`** (Issue #762). Every response row
  carries these base fields, but the record schema described only the entity's own declared properties. Each is now present
  and marked `readOnly: true` (`creator_id` is nullable); an entity's own declaration of `id` is kept. The create-request
  schema and filter parameters are unchanged. `docs/knowledge/generated-documentation-and-openapi-spec.md` states the rule.
- **Dev-tooling dependency advisories cleared where a fix exists** (Issue #582). `npm audit fix` updates the lockfile, and `overrides` raise `@xmldom/xmldom` (pinned by `speech-rule-engine`), `basic-ftp`, `katex` and `postcss-selector-parser` (pinned by `@tailwindcss/typography`) to patched releases. `npm audit --omit=dev` now reports 0 vulnerabilities. `extract-zip` and `braces` still have no patched release; they are reachable only through dev tooling (`@marp-team/marp-cli`, `eslint-config-next`).
- **Transient and missing-record Prisma errors no longer return 422** (Issue #747). The generated `add{Entity}` and
  `update{Entity}` catch blocks now map `P2034` (write conflict under Serializable isolation) and `P2037` (too many
  connections) to `CAPACITY` (409), and `P2025` (required record not found) to `NOT_FOUND` (404). Input-shaped codes still
  return `VALIDATION` (422). See `docs/knowledge/p2028-capacity-misclassification-fix.md`.
- **The Completion gate's UI Cypress step now runs `cypress/e2e/auth/**`** (Issue #580). `test:e2e:cy:ui` matched only 
  `cypress/e2e/*.cy.ts` and `cypress/e2e/mobile/*.cy.ts`, so the auth specs (`mfa.cy.ts`, `settings_avatar_save.cy.ts`) ran 
  in CI's `e2e-tests` job but in no gate step. The script's `--spec` now includes `cypress/e2e/auth/**`, and a pytest fails 
  when a directory under `cypress/e2e/` holding specs is matched by no `test:e2e:cy:api` / `test:e2e:cy:ui` glob. The gate 
  document notes that the MFA spec needs `MOCK_GOOGLE_OAUTH_TEST=true` in `.env.test.local`.
- **Schema validation rejects an `x-state-machines` field whose enum has a value the diagram never mentions** (Issue #715). 
  Previously a new enum value added without a diagram update generated cleanly, appeared as a UI option, and then failed every 
  write with a generic "not a valid initial state" error. `generate-code` now fails and names the missing value(s) and the 
  diagram file. A `null` member of a nullable enum is not a state and is ignored.
- **`--prune-orphans` now removes the pages, API routes, flat Cypress specs and conditional component files of a removed entity** (Issue #618).
  After an entity left the schema, `app/[locale]/<entity>/`, `app/api/<entity>/`, `cypress/e2e/**/<entity>.cy.ts` and
  `components/<entity>/SplitActionSection.tsx` / `ImportModal.tsx` stayed on disk and broke the next build. Pages and routes are deleted only when they
  import their own `@/lib/<entity>/` module; specs only with the `AUTO-GENERATED` header; the built-in `audit_log` routes are allowlisted.
  `docs/knowledge/cleanup.md` lists the sweep.
- **`x-autocomplete-context` is rejected where it generated broken or ignored output** (Issue #880). Schema validation now fails
  when the key names a plain text, number, decimal or `format: uri` field (the form holds these in a ref, so the generated
  `formValues` referred to an undeclared variable) and when it sits on a `one-to-one` or `one-to-one_bridge` FK (the picker
  ignored it). The message names the entity, the FK and the field. See `docs/knowledge/x-autocomplete-context.md`.
- **Generated populate helpers seed distinct numeric values when a column's `minimum` / `maximum` is tighter than the row spacing** 
  (Issue #841). Indexed rows were clamped to the same value (`minimum: 500` seeded 500 for every row), so a row-specific label 
  assertion could match several rows. Rows are now spaced 100 apart from `max(minimum, 100)`, and when `maximum` leaves no 
  room for that spacing they take consecutive values from the lower bound (`minimum: 1, maximum: 50` seeds 1, 2, 3, ...). 
  A column with no bound, or a wide range, seeds 100, 200, 300, ... as before. The populate helper and the expected label 
  still derive from one rule.
- **Mobile card list no longer shows delete controls for an entity with `x-generate.delete: false`** (Issue #578). 
  `CardListClient` now requires `removeAction` in addition to the delete permission before rendering the toolbar delete 
  button and the per-card checkbox, matching `DataGridClient`. The generated mobile list specs count cards through 
  `[data-testid="mobile-card-list"] .MuiCard-root` instead of the delete checkboxes, so they hold for an entity with no 
  delete action.
- **Nav group resolution no longer breaks on non-schema nav entries** (Issue #799). `generators_i18n.py` and `cleanup.py` now pass
  `entities + nav_extra_entities(schema)` to `build_nav_config`, the same list used for the nav labels and links, and `_entity_nav`
  returns no `x-nav` for an entry without a schema definition instead of raising `KeyError: 'model'`. The scheduled-task admin
  link stays a flat top-level link; placing it in an `x-nav-groups` group remains unsupported
  (`docs/knowledge/nested-nav-menu-design.md` §4).
- **Native app header no longer sits under the system UI and its actions are large enough to press** (Issue #1014). The 
  header and footer now apply the top and bottom safe-area insets, and each header action is at least 44x44 points.
- **Generated delete examples check the rows exist first for an entity with no unique primary link** (Issue #835). 
  Examples 4.1, 4.2 and 4.3 in the generated UI spec now assert the populated row count before they delete, so an example 
  that finds nothing to delete fails on its own precondition. Entities with a unique primary link are unchanged.
- **Approve, Reject and Withdraw no longer fire without waiting** (Issue #500). `ApprovalSection` now awaits the Server Action,
  disables every approve/reject/withdraw control (and keeps the confirmation dialog open) until the request settles, and shows an
  error message when the request fails, so two quick clicks can no longer run overlapping approval transactions on the server.
- **Mobile sign-in no longer fails in Expo Go** (Issue #1010, part of #140). The generated `lib/token-storage.ts` asked `expo-secure-store` for a biometric-locked refresh token, which Expo Go rejects because its `Info.plist` has no `NSFaceIDUsageDescription`. When `Constants.executionEnvironment` is `storeClient` the token is now saved and read without the lock; standalone and development builds lock it exactly as before, the choice is made once for save and read, and a rejected locked save is never retried unlocked. Face ID cannot be checked in Expo Go. See `docs/knowledge/mobile-executable.md`.
- **Version Of E2E gate fixture: two flaky examples fixed** (Issue #1000). `version_of.cy.ts` looked the Save button up document-wide, so it found two submit buttons while React streamed the new-version screen (the revealed form plus a hidden copy in the streaming buffer, for about 30 ms); it now looks inside `main form`. `version_of_ui.cy.ts` and `version_of.cy.ts` read values with a one-shot `.then`, so the diff assertion could see the previous pair right after "Compare"; they now assert in a retried `.should`. Test fixtures only; generated code is unchanged. See `docs/knowledge/testing-cypress.md`.
- **CI: a docs-only push no longer cancels or hides the E2E run of a preceding code push** (Issue #882). Push runs now use a
  per-commit concurrency group and are never cancelled; pull_request runs keep the per-branch group with cancel-in-progress.
  CI workflow change: see the note in `.github/workflows/ci.yml`.
- **Consumer `ci.yml` canonical source: same concurrency fix** (Issue #605). `docs/consumer-commands/ci.yml` now carries the
  concurrency block that `.github/workflows/ci.yml` has (per-commit group for push runs, never cancelled; per-head-branch
  group for pull_request runs). A consumer's `Verify ci.yml` job fails after a submodule bump past this change until its own
  `ci.yml` is copied from the canonical file.
- **Dashboard aggregate: read permission and row-level scope on both entry points** (Issue #910). The `aggregateForWidget` 
  Server Action now requires the user's `read` permission on the entity, as `POST /api/dashboard/aggregate` already did, 
  and both paths limit every query (single and two-field group-by, bucketed queries, FK label lookups) to the rows the user 
  can list: organization isolation, `x-self-only`, `x-filter-values` and Creator/Assignee-only read. FK labels are resolved 
  through the target entity's permission and scope, and an unreadable label shows as `(unknown)`. `aggregateForWidgetCore` 
  takes the acting user's id as its first argument. See `docs/knowledge/schema-yaml-configuration.md` §10.
- **Mobile Playwright proxy no longer dies on a reset socket** (Issue #897). `mobile/scripts/same-origin-proxy.js` ended the whole process
  when the API or web server reset its socket in the middle of a response, which made every later spec fail with
  `ERR_CONNECTION_REFUSED`. A reset on either side now ends only that one request. Covered by `scripts/same-origin-proxy.test.ts`.
- **Flattened one-to-one children no longer reference an undefined `userId`** (Issue #965). The create and upsert writes that 
  `add<Entity>` / `update<Entity>` emit for a flattened child (a singular `$ref` with `x-outputType: flatten`, FK on the child) 
  used `creator_id: userId, updater_id: userId`, but those service functions take the acting user as `actorId`, so the 
  generated `service.ts` failed `tsc` with TS2304. They now use `actorId`.
- **Dashboard UI specs no longer assume an empty dashboard catalog** (Issue #997). The generated `dashboard.cy.ts` now uses a 
  real data source and fitting widget settings when the schema enables entities for the dashboard, and 
  `dashboard_widget_editor.cy.ts` detects the catalog state and seeds widgets with an unavailable data source through the 
  database instead of the validating API. Test code only; output for a schema with no dashboard entities is unchanged.
- **Dashboard aggregate: read permission and row-level scope on both entry points** (Issue #910). The `aggregateForWidget` 
  Server Action now requires the user's `read` permission on the entity, as `POST /api/dashboard/aggregate` already did, 
  and both paths limit every query (single and two-field group-by, bucketed queries, FK label lookups) to the rows the user 
  can list: organization isolation, `x-self-only`, `x-filter-values` and Creator/Assignee-only read. FK labels are resolved 
  through the target entity's permission and scope, and an unreadable label shows as `(unknown)`. `aggregateForWidgetCore` 
  takes the acting user's id as its first argument. See `docs/knowledge/schema-yaml-configuration.md` §10.
- **MUI DataGrid and date picker text follows the app locale** (Issue #765, Refs #764). The theme in `app/[locale]/providers.tsx` is built per locale with the `jaJP` bundles of `@mui/material`, `@mui/x-data-grid` and `@mui/x-date-pickers` (new `lib/mui-locale.ts`), so the column menu, filter panel and "Manage columns" are Japanese on `/ja`. One app-wide `LocalizationProvider` carries the dayjs locale; the nested providers in `DateTimeWrapper`, `AppDatePicker` and `GanttChart` are removed so pickers no longer reset to English. The native date inputs of DataGrid date columns are unchanged. See `docs/knowledge/i18n-locale-routing.md`.
- **`x-version-of`: a rejected version no longer blocks the next one, and the version number cannot be written** (Refs #946). A terminally
  rejected version stays as a closed record and is not counted as an open draft; a version rejected without `terminal`, or
  withdrawn, stays the open draft that is fixed and resubmitted. Neither is deleted any more. A number sent by a form or an API
  client is dropped (create stores none, update keeps the stored value): an empty numeric field arrives as `0` and made the next
  draft collide on `(identity, number)` with an earlier row holding `0`. See `docs/knowledge/schema-yaml-configuration.md`.
- **`npm run test:flows` no longer destroys the working tree and runs serially.** `test/flows/cleanup.test.ts` ran
  `npm run cleanup:all` (`--prune-orphans`) in the working tree itself, which deleted the generated code
  (`lib/*/service.ts`, ...); it now runs on a disposable copy and asserts the working tree is unchanged.
  `vitest.flows.config.ts` sets `fileParallelism: false`, and `startServer` removes only a stale `.next/dev/lock`
  instead of the whole `.next` directory. `multistage_approval_rounds.test.ts` supplies its own
  `on_withdrawn`-declaring approvable instead of relying on an entity of the consumer's schema. See
  `docs/knowledge/flows-tests.md`.
- The virtual column resolver stub was never announced in the `ACTION REQUIRED` summary: `_write_stub` returned `None`, so
  the notice keyed on its result never fired. It now returns whether it created the file.
- **Attachment bridge: `setAttachmentsForBridge` only accepts attachment ids of the record being edited** (Issue #958).
  An id belonging to another record, in the same or another organization, or to another attachment type now rejects the
  whole call with `NOT_FOUND` before anything is written, and the update filters on `attachable_id` as well.
- **Generated Cypress helpers: `selectAutocomplete` and the DataGrid cell helpers work for long labels and wide grids.**
  `selectAutocomplete` compared the option text with whitespace collapsed but the expected label as-is, so a label with
  trailing empty segments (for example an inventory with no lot number or expiry date) never matched. The expected label
  is now collapsed the same way. `getDataGridCell` (and so `editDataGridCell` / `fillDataGridRow`) now scrolls the grid
  horizontally until the column is rendered, because MUI DataGrid virtualizes columns that are off screen (the
  `dashboard_widget` grid lost `group_by_field` once `timezone` was added in front of it).
- **Mobile: the Audit Log screen no longer shows "An unexpected error occurred"** (Issue #926). `GET /api/audit_log`
  and `GET /api/audit_log/<id>` authenticated with `authenticateApiKey()`, which does not understand the mobile
  access token, so the app's `Authorization: Bearer <jwt>` request was answered `401 Invalid API key.`. Both routes
  now use `authenticate()` like every generated entity route (mobile access token or API key); permission checks
  and the service API key path are unchanged.
- **`audit_log` monthly partitions can be created by the restricted application role** (Issue #952). `audit_log_create_month_partition()`
  is now `SECURITY DEFINER` with a pinned `search_path` and `EXECUTE` revoked from `PUBLIC`; `audit_log_app_role.sql` grants it to the
  application role. Re-run `audit_log_append_only.sql` and `audit_log_app_role.sql` on existing databases. The docs now say the
  consumer sets up the role's rights on other tables, and no longer claim every `neon_superuser` member can disable the trigger
  (verified for the table owner only). See `docs/knowledge/audit-log-append-only.md`.

### Added
- **Mobile: entities with an editable child collection** (Issue #939). An entity whose form has an editable one-to-many
  grid (for example `asn.lines`, `purchase_order.lines`) is no longer left on the "not available in the mobile app yet"
  placeholder. The Expo form draws a row editor (add, remove, and each row's own fields, including relation pickers),
  sends the rows as the property array of the existing POST and PUT routes, and the detail screen lists them. A child
  that is independent, a `list` child that is not a many-to-many, or a row field with no native control still keeps the
  placeholder; the generation log names the property and field. See `docs/knowledge/mobile-app.md`.
- **Mobile: direct attachment fields** (Issue #931). An entity with an `x-relationship: {target: attachment,
  type: direct}` field (for example `leave_request.medical_certificate_id`) is no longer left on the
  "not available in the mobile app yet" placeholder. The Expo form picks a file with the system document picker
  (`expo-document-picker`, added to `mobile/package.json` only when some entity has such a field), uploads it
  through `POST /api/upload`, creates the `attachment` row through the new `POST /api/attachment/direct`, and
  submits the row's id with the entity, as the Web form does; the detail screen shows the file name and opens the
  file. `POST /api/upload` now accepts a mobile access token or API key in addition to the browser session (a
  caller with no valid credential still gets `401 {"error": "Unauthorized"}`); `POST /api/attachment/direct` runs the
  existing `createDirectAttachment` action as the authenticated caller, so permissions and organization
  checks are unchanged: any authenticated user may store a file and create the unlinked row, and the entity's own
  `create` / `update` permission decides whether the link is saved. Entities that also declare polymorphic
  attachments, virtual columns or another unsupported feature keep the placeholder; the generation log still names
  the reason. See `docs/knowledge/mobile-app.md`.
- **Dashboard widget time zone and `created_at` / `updated_at` buckets** (Issue #911). `dashboard_widget` has a
  new `timezone` column of the shared `Timezone` enum (default `utc`, the zone every bucket used before). Day,
  week (Monday start), month, quarter and year boundaries of a date-time group-by field are computed in that
  zone, following DST changes; date-only fields keep their stored calendar date (UTC), and a non-`utc` zone on
  a field that is not a date-time is answered with `400` when the chart is computed. The zone is resolved only
  through `TIMEZONE_IANA_NAME`. A non-UTC zone is named in the widget subheader. `POST /api/dashboard/aggregate`
  accepts an optional `timezone` (the enum literal, for example `asia_tokyo`); an unknown value returns `400`.
  Every dashboardable entity's catalog now lists `created_at` and `updated_at` as date-time fields, so they can
  be time-bucketed. **Consumers with existing data** run `scripts/migrations/05_dashboard_widget_timezone.sql`
  once, after `04_app_setting_timezone_enum.sql`. See `docs/knowledge/timezone-handling.md`.
- **Report which entities are left out of the mobile app** (Issue #925). `generate-code` prints the entities that
  keep the "not available in the mobile app yet" placeholder, grouped by reason, and writes the same list to
  `mobile/MOBILE_ENTITIES.md`. Only generated `mobile/` output gains that one file (and only when
  `x-generator.mobile.enabled` is true); no screen, schema key or Web file changes. See `docs/knowledge/mobile-app.md`.
- **`app_setting.timezone` is a native `Timezone` enum** (Issue #921). The column was a free `String`; any
  text could be stored through the form, REST, CSV import and the seed. It is now a Prisma enum of 54 zones
  covering every standard-time UTC offset, with snake_case members (`asia_tokyo`) that are never renamed. The
  IANA spelling (`Asia/Tokyo`) is written only in the generated `lib/_timezone.ts`
  (`TIMEZONE_IANA_NAME`, also copied to `mobile/lib/`); display names come from the `Timezone` namespace of
  `messages/*.json`. `TimeZoneSelect` lists the enum members and their labels, and the generated New/Edit form
  now renders it for the field. **Consumers with existing `app_setting` rows** run
  `scripts/migrations/04_app_setting_timezone_enum.sql` once (it records every coerced value in
  `"_app_setting_timezone_coerced"`); `bash scripts/check_timezone_migration.sh` exercises it. See
  `docs/knowledge/timezone-handling.md`.
- **Mobile: sort and filter a list by a relation column** (Issue #923, sub-issue of #140). The Expo list's sort
  and filter panel now offers the relation display columns the REST list already supports (for example Room >
  Room Type), derived from the same `sort_filter_relation_fields` as the Web list. The Web list is unchanged.
  See `docs/knowledge/mobile-app.md`.
- **Mobile: write comments and mention users** (Issues #861, #862). On an entity that has the comment write
  routes, the Expo detail screen's comment thread gets a comment box, Edit and Delete on comments, and, when
  the schema has an `x-mention` field, a user lookup while typing `@`. It calls only
  `POST` / `PATCH` / `DELETE /api/<entity>/<id>/comments` and `GET /api/mention/users`, so the server's
  permission and organization checks apply. The REST detail now also lists each comment's `mentions` (`id` and
  `name`, in order) so an edit keeps the mention markers. New `lib/comment-composer.ts` in `mobile/`; no schema
  key is added and the Web screens are unchanged. See `docs/knowledge/mobile-app.md`.
- **Search box, multi-column sort and multi-field filter on the Web entity lists** (Issue #899, Phase 1 of #898).
  The Desktop Web grid and the Mobile Web cards get one shared panel above the list: a search box that matches
  the list's title column, a sort panel that sorts by several columns in the order they are chosen (ascending,
  descending, off), and a filter panel with a control for every text, number, decimal, boolean and enum column
  (and each relation display column), all applied together. Until now the grid sorted and filtered one column at a
  time (`@mui/x-data-grid`'s MIT build forces that) and the card list had no sort or filter at all. The panel is
  `components/_standard/ListQueryPanel.tsx`, driven by a `listQuery` spec each generated list page builds from the
  REST list's own allow-list (the same data `SORTABLE_FIELDS`, `FILTERABLE_FIELDS` and `FIELD_KINDS` render from); a
  list without the spec is unchanged. The state and the request logic are `lib/_list_query.ts`, which the Expo list
  now uses too (copied into `mobile/lib/` unchanged; the native list still sorts one column at a time). The REST
  list's accepted columns are unchanged and no `x-*` key is added. See `docs/knowledge/list-search-panel.md`.
- **Mobile access tokens are accepted by the dual-auth routes** (Issue #883). `resolveActorId()` and
  `requireDualAuth()` in `lib/api-auth.ts` dispatch an `Authorization: Bearer` token by shape, the same way
  `requireCaller()` does, so CSV export and import, `GET /api/openapi.json` and the
  scheduled-task routes accept a mobile access token. `X-API-Key`, API-key bearer tokens and the session
  cookie behave as before; permission and organization checks are unchanged. See
  `docs/knowledge/multi-tenancy-and-permissions.md`.
- **Mobile: create the referenced record in place, and payment checkout** (Issues #877, #872). A
  many-to-one foreign key that declares `x-create-inline` shows *Create new* in the native picker; it
  opens the target's native create form over the hosting form, saves through the target's REST create
  route and selects the new record. An `x-payment` entity now has native screens: saving opens the
  create response's `checkoutUrl` in the in-app browser (`expo-web-browser`, added only for apps with an
  `x-payment` entity) and the detail screen shows a returned notice. New `Payment.returnedMessage`
  text. See `docs/knowledge/mobile-app.md`.
- **Scheduled task administration screen in the Expo mobile app** (Issue #867). When the schema declares a
  scheduled task, `generate-code` renders an overview screen into `mobile/` that reads
  `GET /api/scheduled-task-runs` (status, times, message and the reason a task did not run, for a chosen business
  date, plus failed or stuck runs of other dates) and offers rerun, mark resolved and skip through
  `POST /api/scheduled-task-runs/<task>/<action>`. Only the actions the server marks open are shown, and the role
  check stays on the server: the nav link is hidden by `GET /api/mobile/nav`, and a `403` is shown as the server's
  answer. No schema key is added and the Web admin page is unchanged. `build_mobile_nav()` takes
  `include_scheduled_tasks`. See `docs/knowledge/mobile-app.md`.
- **Sort, filter, search and bulk delete on the Expo mobile list** (Issues #874, #856). The native list
  gets a sort panel, a filter panel (text, number, decimal, boolean and enum fields) and a search box that
  matches the row's title column, all through the REST list's `sort` and `f.<field>` parameters; a long press
  starts a selection mode that deletes the selected records with `DELETE /api/{entity}/bulk`, with the single
  delete's confirmation and error messages. New `Common.sort`, `Common.filter` and `Common.selectedCount`
  messages. CSV export and import stay out until the export and import routes accept a mobile access token
  (Issue #883). See `docs/knowledge/mobile-app.md`.
- **Approval section and split action on the mobile detail screen** (Issues #858 and #859).
  An entity that declares `x-approval` (the `approvable` bridge and the `ApprovalSection` view component)
  now gets native screens in the Expo app. Its detail screen lists the current round's approval requests
  with their status and shows approve, reject (with a reason and its kind) and withdraw under the same
  conditions as the Web section; each action calls the existing `POST /api/approval_request/{id}/approve|reject|withdraw`
  route. The app evaluates no role, order or ownership rule: `GET /api/{entity}/{id}/capabilities` now also
  lists `approval.current_round_request_ids` and `approval.actionable_request_ids`, computed by the checks
  the approval routes already run, and the buttons follow them. A row the server reports as locked
  (`write_locks.edit_locked` / `delete_locked`) hides Edit and Delete, and values only the approval workflow
  may write are not offered by the form. The shared `use_entity_approval_actions.ts` and
  `submit_predicate.ts` are copied into `mobile/` unchanged. An approval entity with `x-splittable` and a
  `quantityField` also gets a split section: parts with a quantity and the `perPartRequired` fields (relation
  pickers for foreign keys), Split enabled only while the parts add up to the record's quantity, posted to
  the existing `POST /api/{entity}/{id}/actions/split` route, whose refusal text is shown. The
  Playwright proxy no longer exits on a reset browser socket. Submitting for approval from the app is not
  implemented yet. See `docs/knowledge/mobile-app.md`.
- **REST routes for the scheduled-task administration** (Issue #887). When the schema declares a scheduled task,
  `GET /api/scheduled-task-runs` returns the admin page's overview (one row per task with its last-run status and the
  open actions, plus failed or stuck runs of other dates) and `POST /api/scheduled-task-runs/{task}/{rerun|resolve|skip}`
  runs the operator actions, so a client that cannot call Server Actions, such as the mobile app, can show and operate
  them. The routes call the page's own loader and a new `performOperatorAction()` that the Server Actions now call too,
  so validation, the run guard and the audit row are shared. They accept a mobile access token or an API key and answer
  `403` without the `ScheduledTaskRunner` role. A new gate, `test:scheduled-task-e2e-gate`, runs their Cypress API specs
  against a generated fixture app. See `docs/knowledge/scheduled-task-operations.md`.
- **REST routes for comment writes and the @-mention user search** (Issue #885). An entity with a comment
  thread gets `POST /api/{entity}/{id}/comments` and `PATCH` / `DELETE
  /api/{entity}/{id}/comments/{commentId}`, and a schema with an `x-mention` field gets `GET
  /api/mention/users?q=`, so a client that cannot call Server Actions, such as the mobile app, can post,
  edit and delete comments and offer `@`-mention suggestions. The routes run the
  `add/update/delete{Entity}Comment()` actions and `searchMentionUserOptions()` the web form calls, as the
  authenticated caller (mobile access token or API key), so the stored message, the notifications, the
  author-only edit and the delete rule are the web's own. Because the actions rely on the edit form for
  access control, each comment route first requires `update` on the entity and finds the record through
  `get{Entity}Detail()` (strict organization isolation); a comment of another record is `404`. The add
  action now returns the id of the new comment. The OpenAPI document describes the routes. New
  `npm run test:comment-rest-e2e-gate` builds and runs a fixture app with a commentable entity, because the
  repository's own schema has none. See `docs/knowledge/comment-and-mention-rest-routes.md`.
- **Read-only audit log screens in the Expo mobile app** (Issue #866). `generate-code` renders a paged list
  (newest first) and a detail screen for the built-in audit log into `mobile/`, reading the existing
  `GET /api/audit_log` and `GET /api/audit_log/<id>` routes only. The navigation gets an **Audit Log** link
  in the `administration` group (a flat tab when the schema declares no such group), matching the desktop
  sidebar; the link is hidden for a caller without `read` on `audit_log` (the existing `GET /api/mobile/nav`
  rule), and a refused list request shows the shared permission message. No schema key is added and the Web
  screens are unchanged. `build_mobile_nav()` takes `include_audit_log` for the new link. See
  `docs/knowledge/mobile-app.md`. Scheduled task administration (#867) is not part of this change: the task
  list and last-run status have no REST route for a client to call.
- **Comment thread and reactions on the mobile detail screen** (Issue #863; the thread part of Issue #861
  and the mention rendering of Issue #862). An entity that is commentable through the shared `commentable`
  bridge keeps its native screens instead of the placeholder, and its detail screen lists the comments the
  REST detail embeds (author, time, message, with an `@mention` shown as the user's name) and a reaction
  bar per comment. The bar shows the counts and the reactions the signed-in user made, and adds or removes
  one through `/api/comment/{id}/reactions/toggle`; the labels are the web's `ReactionType` messages. The
  composer, editing and deleting a comment and the `@` user lookup are not part of it yet: there is no
  REST route for them. See `docs/knowledge/mobile-app.md`.
- **Documentation for the `x-autocomplete-context` schema key**: where it goes, what it changes in the generated form and split action, how it relates to `autocomplete_filter.ts`, and what validation rejects. See `docs/knowledge/x-autocomplete-context.md`. `docs/knowledge/relation-picker-rest-route.md` now compares the options route with the list API.
- **REST route for relation pickers: `GET /api/{entity}/options`** (Issue #852). Every entity with a REST
  surface gets a route that searches (`q`, `limit`) or looks up by id (`ids`) the records a many-to-one,
  one-to-one or many-to-many field can select, so a client that cannot call Server Actions, such as the
  mobile app, can build the picker. The route calls the `search{Entity}Options()` function the web
  forms call, as the authenticated caller, so read permission, strict organization isolation, the entity's
  autocomplete filter and the row shape are the web's own; it accepts a mobile access token, an API key
  or the session cookie and answers `403` without read on the entity. New `requireCaller()` and
  `withActor()` in `lib/api-auth.ts` (with `runAsActor()` in `lib/_request_scope.ts`) let a route run a
  session-based function as the caller it authenticated. The OpenAPI document describes the route. See
  `docs/knowledge/relation-picker-rest-route.md`.
- **Generated Expo mobile app with footer navigation from `x-nav`** (restart of the mobile line).
  `generate-code` renders an Expo Router project into `mobile/`. Its footer tabs are the desktop
  sidebar's root level — flat entity links, then top-level groups — built by the new
  `code_generator/mobile_nav.py` from `build_nav_config()`, so no schema key is added. Tapping a group
  tab lists its sub-groups and entity links on the main screen (one pushed screen per level, to the
  maximum nesting depth); the bar scrolls horizontally past the visible width and a fixed Search tab
  follows the schema tabs when the app has a search route. Group icons map to `@expo/vector-icons`;
  `WorkOutlined`, `PeopleOutlined` and `SettingsOutlined` use similar `-outline` glyphs. The header keeps
  the title, language switcher, notification bell and sign-out. `GET /api/mobile/nav` hides entity
  links the caller cannot read, using the desktop sidebar's rule. Entity screens are not part of the
  app yet. See `docs/knowledge/mobile-app.md`.
- **Native entity screens in the Expo app for entities without relations.** `generate-code` renders a
  paged list, a detail screen, a create/edit form and a single-record delete (with confirmation) for
  every entity that has REST routes and no relation, child, custom component or similar feature
  (`code_generator/mobile_entities.py`; other entities keep the placeholder screen). The screens draw
  native controls and call the same generated modules the Web screens call —
  `use_entity_form`, `use_entity_capabilities` and `form_validation` are rendered from the same
  templates into `mobile/` — so state, validation, submit and permission-based show/hide are not
  re-implemented. A per-entity `lib/<entity>/mobile_client.ts` has the Web function names and calls the
  existing REST routes. New `GET /api/mobile/permissions?entity=<name>` returns the caller's
  model-level flags so the app can hide "New" before any record exists. The Web screens and routes are
  unchanged. The app moves to Expo SDK 57 (React 19.2, React Native 0.86, one pinned set)
  because the shared form hook starts an async transition, which needs React 19.
  `scripts/run_mobile_entity_playwright.sh` runs the Playwright specs against a build with
  fixture entities (`mobile/e2e/entity-crud.spec.ts`) or the default schema. See
  `docs/knowledge/mobile-app.md`.
- **Relation pickers in the Expo app's entity screens.** A many-to-one foreign key, a one-to-one
  selector and a many-to-many declared with `x-outputType: list` are drawn as native pickers (search, select,
  clear; chips for a set) whose candidates come from `GET /api/{entity}/options`, so an entity with
  such fields now gets native list, detail and form screens (`code_generator/mobile_entities.py`;
  in the default schema `role`, `organization` and `app_setting` now qualify). The shared form modules still do the work: the
  required-foreign-key check is the Web form's `form_validation.ts`, and the picker forwards the hosting
  entity and the form values a field names with `x-autocomplete-context`. A target the caller cannot read
  shows the field disabled with the Web message; the detail screen shows related records by label.
  `Common` gains `select`, `clear`, `done`, `search` and `noOptions` in both locales.
  `mobile/e2e/relation-pickers.spec.ts` runs through `scripts/run_mobile_entity_playwright.sh`.
  Creating a referenced record in place and the one-to-one bridge grid are not part of the app yet.
  See `docs/knowledge/mobile-app.md`.
- **Email/password token authentication for the mobile app.** `POST /api/mobile/auth/token`
  (password grant, MFA-aware, rate-limited), `POST /api/mobile/auth/refresh` (rotating refresh token
  with reuse detection), `DELETE /api/mobile/auth/token` and device-session routes under
  `/api/mobile/auth/sessions`, backed by the new `mobile_session` table. Generated REST routes now call
  `authenticate()`, which accepts a mobile access token or an API key; `GET /api/notifications` also
  accepts the bearer token. Existing API-key callers are unchanged. The Playwright base for the mobile
  web bundle lives in `mobile/e2e` and runs with `npm run test:e2e:mobile:pw`.
- **Create the referenced record in place from a foreign-key field** (issue #846, stage 1). A
  many-to-one FK field that declares the new `x-create-inline: true` key (on the field, beside
  `x-relationship`) also offers *Create new* in its autocomplete. It opens the target entity's own
  generated form in a dialog and selects the saved record in the field. The dialog saves through the
  target's own `upsert` action, which gains a return-id mode (`__return_id`) that returns
  `{ ok: true, id }` instead of redirecting and runs after the same permission check, validation and
  organisation check as the target's own form. Schema validation rejects, naming the entity and
  field: a field that is not many-to-one, a target with `x-approval`, `x-payment`, `x-self-only` or
  `x-internal`, a target with no generated create form, a target that itself declares the key
  (nesting depth is 1) and a non-boolean value. The created record stays if the parent form is never
  saved, and the field says so (`Common.createdInlineNotice`); `Common.createNew` is the other new
  message. Generated for a target only when some field offers it: `lib/<target>/inline_create.ts`,
  `components/<target>/InlineCreateDialog.tsx`; `components/_standard/InlineCreate.tsx` is the
  shared dialog context. Not covered yet: FK cells of an embedded child DataGrid, many-to-many fields
  and the independent-children "add existing" list. See
  `docs/knowledge/create-fk-record-in-place.md`.
- **"Save and continue editing" button on generated forms** (issue #832). A second submit button
  beside Save saves the record and stays on it: after a create the URL moves from `/new` to
  `/edit/[id]`, so attachments and comments can be used straight away; after an update the same
  edit screen reloads with the saved values. A failed save keeps the form and its values. The
  button is not generated for `x-generate.edit: false`, `x-payment` and approval-lockable
  entities, and on `/new` it is shown only to a user with update permission (a user whose update
  right comes only from the Creator role does not get it there). The edit page keys the form on a
  `saved` search parameter so embedded child grids are re-seeded from the saved record. No new
  `x-*` key; `Common.saveAndContinue` is the new message. See
  `docs/knowledge/save-and-continue-editing.md`.

### Changed
- **Mobile app generation is opt-in** (Issue #915). `generate-code` no longer renders the Expo app into
  `mobile/` unless the schema sets `x-generator.mobile.enabled: true` (default `false`); the key is
  validated (boolean only, unknown sub-keys rejected). A project that wants to keep `mobile/` must set the
  key in its own schema. The hand-written mobile token routes under `app/api/mobile/` stay in place. After
  switching the key to `false`, run `npm run cleanup` to remove the previously generated `mobile/` files.
  `scripts/run_mobile_entity_playwright.sh` enables the key in every mode and fails if `mobile/` is absent.
  See `docs/knowledge/mobile-app.md`.
- **Generated entity screens call framework-neutral UI hooks.** The form state and submit
  orchestration, error-message mapping, permission-derived show/hide decisions and approval wiring
  that `FormUpsert.tsx` and `FormView.tsx` carried inline now live in `lib/<entity>/use_entity_form.ts`,
  `use_entity_capabilities.ts` and (for entities that render `ApprovalSection`)
  `use_entity_approval_actions.ts`, which import no Next.js, `next-intl`, DOM or UI-library module,
  so another client can reuse them. `ApprovalSection`'s per-row approve/reject check is the exported
  pure function `canActOnApprovalRequest` in `lib/approval_request/submit_predicate.ts`. Generated Web
  behaviour is unchanged. See `docs/knowledge/shared-ui-hooks.md`.
- **A list-view entity must declare an `x-display.table` column with `primary: true`**
  (issue #837). Schema validation now fails, naming the entity, when an entity that has a list page
  declares none; a shown column merely named `name` no longer stands in for it. Entities with
  `x-generate.list: false`, a chart-only `x-display`, `x-internal` entities and child-only
  entities are not affected, and there is no exception by entity name. The default schema's
  `role`, `organization` and `permission` declare it (the list link and card title stay on `name`;
  `role` and `organization` now declare their `name` and `description` columns explicitly, with
  `@@index` entries on both), so every consumer picks this up on its next generator update and
  must add the declaration to any entity of its own that lacks one.
  The generated specs no longer guess when no primary is declared: the UI spec's `name`-column
  fallback and its no-primary navigation-by-record-id variant (issues #698, #831) and the API
  spec's `name` assertion are removed, and a UI spec for an entity that has a list view but no primary column is
  refused (an entity with `x-generate.list: false` needs no primary and gets no list steps). The shared list components still default `primaryField` to `name`; that default is
  not changed here.

### Removed
- **Stopped generating the standalone Checkout Session route
  `app/api/payment/checkout/route.ts` for `x-payment`** (issue #785). Any signed-in
  user or API key could POST an arbitrary `price_id` to it and get a Checkout
  Session for any Price. Nothing generated called it: Checkout starts from the
  `x-payment` entity's own create path (`lib/payment/checkout.ts`), which reads
  the Price from the entity, so the payment flow is unchanged. An app generated
  earlier keeps its copy unless `npm run cleanup` removes it (only when it is
  unedited); delete `app/api/payment/checkout/route.ts` by hand if it is still
  there and the app does not use it.

### Fixed
- **Date, date-time and time values are validated; the mobile inputs check them** (Issue #924, sub-issue of #140).
  A date-time field on the Expo form was a plain text box: typing `test` passed the client check and the server
  failed with an HTTP 500 from Prisma. A date / date-time / time column is now checked by one module,
  `lib/_date_value.ts`, in the Web form validation, in the server write guard (`service_validation.ts`; the REST
  routes and Server Actions now return a `VALIDATION` error, HTTP 400, instead of a 500) and in the new mobile
  `DateValueInput`, which normalizes typed text to the shared value shape, shows a field error and offers a
  *Today* / *Now* button. The module is copied into `mobile/lib/` unchanged. No `x-*` key is added. See
  `docs/knowledge/mobile-app.md`.
- **Comment Server Actions check permission and organization scope** (Issue #890). `add`, `update` and
  `delete{Entity}Comment()` only checked that a session user existed (plus the author rule), so a Server
  Action call that skipped the edit form could comment on, edit or delete a comment of a record the caller
  could not update or that belongs to another organization. Each action now reads the parent record through
  the caller's organization scope (and `x-self-only` / `x-filter-values`) and calls `requirePermission()` for
  `update` on it, like `upsert{Entity}()`; delete by a non-author still needs `delete`. A caller who may
  edit the record sees no change. See `docs/knowledge/comment-and-mention-rest-routes.md`.
- **Generated test data wrote several owner columns of an `x-exclusive-parents` entity** (issue #849).
  Dependency rows of such an entity (for example the `parameter` and `step_placement` rows another
  entity's helper creates) and the child rows added by `populate<Parent><Child>Data` set every owner
  FK, a row the entity's own rule forbids; the generated API specs reuse the same rows. They now set
  one owner: the first declared parent's column for a dependency row, the populated parent's column for
  a child row. The generated specs and helpers skip the empty label segment and close the gap, and the
  shared `selectAutocomplete` / `checkField` Cypress commands compare with whitespace collapsed. The
  runtime label is unchanged.
- **`code-generation-custom-extensions.md` no longer shows `target: [new, ...]` for
  `x-custom-components`.** The generator reads only `list`, `view` and `edit`; `new` was silently
  ignored. The examples drop it, and the page now says which values `target` accepts and that an
  `edit` component shows on `/new` too (the create page renders the same form).
- **Matched the integer segment of a relation label in the generated autocomplete search**
  (issue #842). When a relation's `labelField` ends in an integer property (for example a step
  number), typing the label as displayed never found the option: the last token matched no
  string column. The generated `search<Entity>Options()` now also matches a token of 1-9 digits
  by equality against those integer fields. Only entities whose label has such a segment change.
- **Skipped the child grid column that `x-exclusive-parents` hides in a parent's generated UI
  spec** (issue #822). A listed parent's form hides the other parents' FK columns in the
  embedded child grid, but the parent's generated UI spec still selected them, so
  "creates with full data (all fields and children)" timed out waiting for a cell that
  does not exist. The spec now skips every column the form hides. Entities without the
  declaration generate identical output.
- **Wrote exactly one owner in the generated tests of a child that declares
  `x-exclusive-parents`** (issue #819). The generated helper rows, API create bodies
  and form fills left the owner columns empty or set all of them, so the save-time
  validator from #816 rejected the generated PUT and create requests. They now use
  the owner column of the first declared parent that has a resolvable column, as a
  required field, and skip the other owner columns. Entities without the declaration
  generate identical output.
- **Returned the second instance of the primary display FK from the generated test
  helper when its entity has two FKs to the same model** (issue #813). The API spec
  reads `deps.<fk>2` for `PUT /:id` and both bulk `PUT` examples, but the helper only
  returned `<fk>` (and `<fk>Alias`), so those three examples failed with
  `TypeError: Cannot read properties of undefined (reading 'id')`. Entities
  without two FKs to the same model generate byte-identical output.
- **Kept a list child's second FK to the parent's model in the fetched data**
  (issue #801). A child embedded with `x-outputType: list` that had a structural
  FK to the parent plus a separate FK to the same model lost both from the parent
  detail query, so anything reading the second FK (for example a label
  `[name, rel_par.name]`) rendered empty; a sibling list child's own FK to the
  parent's model was dropped the same way. Only the structural parent FK is
  excluded now, and a many-to-many list child, which has none, keeps all of its FKs.
  Added `code_generator/tests/test_list_child_combination_matrix.py` (every
  combination of the seven child axes, with and without the second FK) and the
  `list-child-e2e-gate` fixture gate (`npm run test:list-child-e2e-gate`), which also
  pins that removing a child with no pages, or with read-only pages, from the parent
  screen deletes the child record, and that a child with editable pages and a required
  link to its parent cannot be added to or taken out of the parent's list (screen,
  server action or REST route).
- **A one-to-many list child that already has a parent is no longer moved to
  another parent** (issue #807; behaviour change). For a child embedded with
  `x-outputType: list` that has its own pages and a nullable link to the parent,
  the parent's picker offered children of other parents, and adding one (from the
  screen, the Server Action or the REST route) silently took it away from its
  original parent. The picker now offers only children without a parent, and the
  service rejects any other child with a validation error. For a self-referencing
  child the record itself and all of its ancestors are also excluded and rejected,
  so no cycle can be created. Many-to-many children are unchanged: a child may
  still belong to several parents.
- **Declared the option props of a list child whose link to the parent is
  nullable** (issue #805). `FormUpsertProps` left out `initial{Child}s` and
  `search{Child}Options` for such a child (looked up on the view entity instead
  of the raw one), although the form and the edit and new pages pass and read
  them, so the generated app failed to compile.
- **Started a nullable date, time or date-time column in a new child DataGrid
  row empty** (issue #804) instead of filling it with the current time. A required one still
  starts with a value, and nullable numbers, decimals and enums already started
  empty, so an untouched optional date used to be saved as "now".
- **Stopped one child grid from removing the form props another child grid
  needs** (issue #802). When a read-only independent child, a read-only parent
  FK, or an FK left out of `x-display.form` shared a relation target with an
  editable inline child grid, the parent form dropped that target's
  `initial{Target}s` / `search{Target}Options` props while the grid still used
  them, and the generated app failed to compile (`Cannot find name
  'initial{Target}s'`). The props are now kept whenever an editable child grid
  needs them.
- **Kept a child DataGrid's second FK to the parent's model in the fetched data**
  (issue #800). When an embedded child had a structural FK to the parent plus a
  separate FK to the same model, the parent detail query dropped both, so the
  second FK's grid column rendered empty. Only the structural parent FK is
  excluded now.
- **Stopped asking adopters of `x-payment` to copy the `payable` model into
  `prj/prisma/schema.prisma`** (issue #786). The second `generate-code` in an
  app failed in `prj:sync` with `model payable` reported as dropped, because
  the model is appended by the generator and the consumer snapshot had no copy.
  `prj:sync` now treats the models `generate.py` appends itself (`payable`,
  `scheduled_task_run`) as expected and lets the next `generate-code` append
  them again. Every other missing model or field is still reported.
- **Made the bulk routes reject read-only fields like the single routes do**
  (issue #787). `POST .../bulk` used to drop a read-only field from an item and
  report it as a success, while `POST` answered 400. A bulk create now fails an
  item that carries a read-only field, and a bulk update fails an item whose
  read-only value differs from the stored one, each with the single route's
  message. This applies to every `x-readonly` / `x-readonly-fields` field, not
  only payment fields. A client that relied on a bulk item silently ignoring a
  read-only value now gets that item reported as failed.
- **Made the `x-payment` cancel and success pages settle the record
  themselves, and shortened the Checkout Session lifetime** (issue #789).
  Cancelling used to delete the record only when a later
  `checkout.session.expired` webhook arrived, so nothing was removed where no
  webhook is delivered. The generated cancel page now expires the session and
  removes the record when Stripe reports it expired (a session still open or
  already complete removes nothing). The success page retrieves the session and
  marks the record paid when Stripe reports it paid. The webhook stays as an
  idempotent backstop. Sessions are created with `expires_at` 31 minutes ahead
  (Stripe's 30-minute minimum plus one minute of slack) instead of Stripe's
  24-hour default. The cancel and success pages are write-once, so an existing
  app keeps its old pages until it adds the `removeUnpaidPayable` and
  `retrievePaidSession`/`confirmPaidSession` calls by hand.
- **Made the generated `delete{Entity}()` do nothing for rows that are already
  gone.** It used to write an audit event and run `afterDelete` for every id it
  was given, so deleting the same record twice (or two deletes racing) recorded
  the delete twice. Now only rows the call actually deleted get an audit event
  and hook run.

### Added
- **Hand-written dependency values for the generated test helper** (issue #819).
  Every entity generated with `test: true` gets a write-once
  `cypress/support/<entity>/helper_custom.ts` exporting `dependencyValues(key, defaults)`;
  a consumer keeps its copy at `prj/cypress/support/<entity>/helper_custom.ts`. The
  generated `helper.ts` passes the values of every dependency row it creates, and the
  `where` of every find-or-create lookup, through it, so a rule on a dependency
  (for example a type column that must hold a particular value while its default stays
  unchanged) is written by hand and the rest of the helper stays generated. Plain
  columns may be set; foreign-key and system columns may not be reassigned, and anything
  else throws naming the dependency and the column. No new schema key. Behavior is
  unchanged while the hook returns the defaults, but the text of every generated
  `helper.ts` changes (an import and a call at each dependency create) and each test
  entity gets one new `helper_custom.ts`. Consumers do not track generated output, so
  nothing needs committing. The child-datagrid gate now also runs the generated specs of
  a test-enabled exclusive child and of an entity with a hand-written hook.
- **Hand-written validation can pass an i18n message key to the form** (issue #817).
  An `AppError` takes optional `messageKey` and `messageArgs`. They travel on the Server
  Action failure and in the REST error body (only when present), and the generated form
  shows the translated text instead of "{field} has an invalid or disallowed value."
  Keys for hand-written rules live in the consumer's `ValidationMessages` namespace; a
  missing key falls back to the generic text. Behavior without a key is unchanged, but
  the emitted failure-return lines and the custom-rule wrapper gain the optional fields,
  so regenerated `actions.ts`, `FormUpsert.tsx` and `service_validation.ts` differ.
- **Added `x-exclusive-parents` to hide the other parents' FK columns in an
  embedded child DataGrid** (issue #811). A child owned by exactly one of several
  parents, each through its own nullable FK, declares
  `x-exclusive-parents: [parent_a, parent_b]`. On a listed parent's view and
  create/edit screens the grid omits the other listed parents' parent-link columns;
  other FKs, the child's own pages and a schema without the key are unchanged.
  Validation rejects unknown or duplicate names, fewer than two parents, a parent
  that does not embed the child as a one-to-many DataGrid, and a required parent FK.
  See `docs/knowledge/schema-yaml-configuration.md` §7.7.
- **Rejected saves of an `x-exclusive-parents` child that do not have exactly one
  owner** (issue #814, follow-up to #811). A save that leaves none of the listed
  parents' FK columns set (`missing`) or two or more (`invalid`) now fails with a
  422 `VALIDATION` error on every write path: the child's own service (REST,
  Server Action, CSV import), a parent's nested child create/update, and approval
  `set_fields` that write a listed column. An update is judged on the row as it will
  be after the save. A parent-screen update no longer writes the hidden other-parent
  FK columns, so a row that already holds two owners is rejected there instead of
  being cleared. Application-level only: no schema rule, Prisma change or database
  constraint, and a child without the key is unchanged. Adds the
  `Errors.exclusiveParentsMissing` / `exclusiveParentsInvalid` messages (en, ja).
- **Grouped the built-in administration entities in the sidebar under one
  `administration` group.** `user`, `role`, `permission`, `organization`,
  `approval_flow`, `dashboard` and `app_setting` now sit under a single
  collapsible "Administration" heading, declared in the default schema with the
  same `x-nav` / `x-nav-groups` keys business entities use. Audit Log joins the
  same group as its last entry; it is not a schema entity, so its placement is
  set on its static row in `lib/site-config.ts` rather than through `x-nav`.
  Only Home stays at the top level. A consumer schema moves or reorders the
  seven entities by redeclaring `x-nav`, and edits the Audit Log row in
  `lib/site-config.ts` directly; the heading is hidden when the viewer can read
  none of the eight. Because the generator skips a link that already has a row,
  run `npm run cleanup` before `generate-code` to pick the grouping up in an
  existing app.
- **Added an admin page for scheduled task runs** (issue #774, follow-up to
  #712). When a schema declares a scheduled task, `generate-code` now also
  writes `/scheduled_task_run`: per task and business date it lists the
  status, times and recorded error, says why a task did not run (blocked by a
  named predecessor, already running, stuck, not due), and offers rerun (for
  the recorded date, through the same guard), mark resolved and skip (with a
  reason) for members of the `ScheduledTaskRunner` role. Every action is
  written to the audit log. `app_setting` gains two nullable columns,
  `scheduled_task_stuck_after_minutes` (when a `running` record counts as
  stuck, default 60) and `scheduled_task_recheck_minutes` (stored, not read
  yet); a consumer writes the migration when it deploys. The run guard accepts
  an optional `businessDate`. See `docs/knowledge/scheduled-task-operations.md`.

- **Made `x-payment` create a provisional record that Stripe Checkout then
  confirms or removes** (issue #775). Creating a record of an `x-payment`
  entity, through the form or `POST /api/{entity}`, now stores it with a
  `pending` row in a new generated `payable` table and opens a Checkout
  Session. The form redirects to Stripe, and the API answers
  `{ "record", "checkoutUrl" }` instead of the bare record. The webhook marks the
  row `paid` on success and deletes the record through the entity's own delete
  function when the session expires or the payment fails; a repeated event is
  ignored, and several `x-payment` entities share one webhook. The Stripe Price is
  a required `stripe_price_id` field on the entity or on the one related
  entity that declares it, and `generate-code` fails otherwise; the quantity
  comes from a generated write-once hook (default 1), and Checkout accepts
  promotion codes. A consumer writes its migration for
  `payable` at deploy time, and an existing `app/api/webhooks/stripe/route.ts`
  is refreshed on regeneration only if it is unedited and recorded in the
  manifest; otherwise add the `dispatchPaymentEvent(event)` call by hand.

- **Made `depends_on` between scheduled tasks enforced at run time, and
  added direct-execution scripts and a GCP nightly trigger** (issue #712,
  follow-up to the generate-time validation from #713/#714). Every run of a
  scheduled task now goes through a generated guard
  (`lib/scheduled-tasks/run-guard.ts`) backed by a new `scheduled_task_run`
  table (one row per `task_id` and UTC business date; generated into
  `prisma/schema.prisma` only when a task is declared, so a consumer writes
  its migration at deploy time). The guard suppresses duplicate runs,
  refuses a task whose predecessor has no `succeeded` record for the day,
  and records `failed` handlers; the HTTP route returns 409 for a blocked or
  in-progress task. New `npm run task:run -- <task_id>` and
  `npm run task:run-all` run tasks directly against the database in
  `depends_on` order (a task with an `interval` is skipped on nights it is
  not due; exit codes are documented). `interval` is now optional, and a
  task without one is only run by `task:run-all`. New
  `scripts/gcp-task-runner.sh` provisions a Cloud Run Job and a Cloud
  Scheduler job that run `task:run-all` nightly (`DRY_RUN=true` previews it).
  A consumer must declare `depends_on` in its own schema for any ordering
  to apply. See `docs/knowledge/scheduled-task-operations.md`.

- **Served the generated OpenAPI document at an authenticated route, and
  added a development/staging-only Swagger UI page** (issues #768/#769,
  fifth stage of AI-agent-facing API improvements). `GET
  /api/openapi.json` returns the exact `docs/generated/openapi.json` the
  generator already writes — no second copy — reading it at request time
  via `lib/openapi/document.ts` (`fs.readFileSync` with a runtime-built
  path, listed in `next.config.ts`'s `outputFileTracingIncludes` so it
  survives Vercel's build-output pruning). Authentication is
  `requireDualAuth` (API key or session); no further permission check,
  since the document only reveals schema shape, never row data. Runs in
  every environment, including production. `GET /swagger`
  (`app/[locale]/swagger`) is a separate, `swagger-ui-dist`-based
  interactive explorer that reads its spec from this same route
  (same-origin, no CORS) and lets a developer exercise the API through its
  Authorize dialog. Gated on `SWAGGER_UI_ENABLED === 'true'` (never
  `NODE_ENV`): unset makes the page 404, the same fail-closed treatment
  `TEST_RESET_TOKEN` gives `app/api/test-utils/reset-caches`. Not wired
  into `vercel-setup.sh`/`vercel-env.sh` — enabling it on a Preview
  deployment is a manual, one-off step, and it must never be set on
  Production (every "Try it out" call runs with the caller's own role
  permissions, unrestricted). `openapi.json`'s `info.description` no
  longer says the document goes unserved. See
  `docs/knowledge/generated-documentation-and-openapi-spec.md`.

- **Added durable, schema-independent regression coverage for the list-page
  filter/sort feature (issues #753/#755/#756), plus a wiring-check layer
  that runs against each consumer repo's own real data**: a new
  `lib/_pagination.test.ts` vitest unit-test file exercises
  `buildFilter`/`buildOrderBy` against every `ColumnFilterKind` × its real
  operator table directly (schema-independent, runs in every consumer
  repo's own `test:vitest`); a new generated, single, cross-entity Cypress
  spec (`cypress/e2e/api/_filter_sort_matrix_gen.cy.ts`) auto-selects one
  representative entity/column per `ColumnFilterKind` found in a schema's
  own (`api`+`test`+`list`) entities and exercises the real REST `GET`
  wiring against that data — no new `x-*` key, and a kind absent from a
  given schema is stated explicitly in the file's own header rather than
  silently skipped; and a new `filter_sort_gate` fixture
  (`test:filter-sort-gate`, `tsc`-only, ~6-7s) closes this repo's own
  generate-code/build blind spot for a single entity carrying every kind
  at once (this repo's own schema has zero enum/boolean/decimal/date-kind
  columns). See `docs/knowledge/list-filter-sort-typed-columns.md`.

- **Added optional expiry for API keys** (issue #717, fourth stage of
  AI-agent-facing API improvements — Stage 2 of
  `ai-agent-integration-design.md`). A new nullable `user.api_key_expires_at`
  column (`null` = never expires, matching every existing key's current
  behavior unchanged) is checked in the single shared
  `authenticateApiKey()` (`lib/api-auth.ts`); a request made with an
  expired key is rejected with `401 API key expired.`. No new principal
  type — an agent is an ordinary `user` account, human or agent alike. See
  `docs/knowledge/api-key-expiry.md`.

- **Added `Idempotency-Key` support on single-record API create endpoints
  and per-API-key `api:read`/`api:write` rate-limit buckets** (issue #707,
  third stage of AI-agent-facing API improvements — the "Idempotency keys
  and rate limiting — resolved design" section of
  `ai-agent-integration-design.md`). A client-supplied `Idempotency-Key`
  header on a create `POST` is checked and recorded in a new
  `idempotency_key` table (one-day retention, enforced logically at lookup
  time), written in the *same* transaction as the record it guards — a
  retry with the same key and body replays the original result without
  re-running any create side effects; the same key with a different body
  is rejected as a 409 conflict. Every REST route that authenticates
  exclusively via `authenticateApiKey()` (`api_route.ts.jinja2`,
  `api_detail_route.ts.jinja2`, `api_bulk_route.ts.jinja2`) now also
  enforces a per-caller rate-limit ceiling on the existing
  `lib/rate-limit/` mechanism — 300/min read, 60/min write, both
  env-overridable (`RATE_LIMIT_API_READ_LIMIT`/
  `RATE_LIMIT_API_WRITE_LIMIT`) — keyed by the caller's resolved user id,
  not IP. See `docs/knowledge/api-idempotency-and-rate-limiting.md`.

- **Added an entity-level "Constraints" section to generated docs
  (`doc_entity.md.jinja2`) and a new `docs/generated/openapi.json` OpenAPI
  3.1 build artifact** (issue #707), the first stage of AI-agent-facing
  API improvements. The Constraints section documents, for an entity that
  declares `x-approval` and/or a write-locked field, the approval flow's
  static shape (which stage writes which field/value, whether a rejection
  is terminal) and which (field, value) pairs are system-only — entity-
  level facts true for every row, never row-level truth about a specific
  record's current state. `docs/generated/openapi.json` reuses the same
  static data (field type/required/enum, relationship shape, approval
  flow, write-lock capability, as `x-relationships`/`x-approval`/
  `x-write-locked-values` vendor extensions) to describe every `api: true`
  entity's REST + bulk surface — a build artifact only, never served by a
  deployed app by default. This repo's own `json_schema.yaml` declares no
  `x-approval`/`x-write-locked-values` entity, so the Constraints section
  is exercised only by `test:approval-lockdown-gate`'s fixture. See
  `docs/knowledge/generated-documentation-and-openapi-spec.md` and
  `app-generator-project-docs/planning/ai-agent-integration-design.md`.

- **Added a row-level `GET /api/{entity}/[id]/capabilities` endpoint**
  (issue #707, second stage of AI-agent-facing API improvements),
  generated per `can_view` entity alongside the existing detail route.
  Answers, for one specific row, which operations/writes/transitions are
  legal right now given this row's current data and this caller's
  permissions -- the row-level half the OpenAPI spec above deliberately
  leaves out. Every judgment reuses an already-generated function
  (`canAccess()`, `assertEditAllowed()`/`assertDeleteAllowed()`,
  `assertTransitionAllowed()`, `canSubmitForApproval()`/
  `canWithdrawApproval()`, `assertApprovalOrder()`) rather than a second,
  divergent derivation. See
  `docs/knowledge/generated-documentation-and-openapi-spec.md`'s "The
  row-level capabilities endpoint" section, including a disclosed
  coverage gap on the approvable-bridge branch.

- **Added an optional `depends_on: [task_id, ...]` ordering key to
  `x-scheduled-task` (entity-level) and `x-scheduled-tasks` (top-level)
  declarations** (issue #713), naming other `task_id`s (from either
  mechanism — one shared namespace) that a task is declared to run after.
  `generate-code` validates the resulting dependency graph and fails
  closed on self-dependency, a dangling reference to an undeclared
  `task_id`, and any cycle (however many hops long) — the same
  generation-time fail-closed discipline `x-state-machines` already
  applies to its own diagrams. A straight chain through this key is how
  strict one-at-a-time ordering across a set of tasks is expressed, with
  no separate "serialize these tasks" mechanism needed. This change is
  schema validation only: no generated handler reads or waits on
  `depends_on` yet, and no completion-record mechanism exists yet to check
  a predecessor's actual runtime completion — see
  `docs/knowledge/scheduled-task-operations.md`'s new "Declaring ordering
  between tasks" section and `planning/batch-ordering-design.md`
  (app-generator-project-docs) for the full design and the staged
  follow-up work.

- **Closed five gaps in the generated OpenAPI 3.1 build artifact** (issue
  #762, follow-up to #707): `GET /api/{parent}` now declares `page`/
  `pageSize`/`sort`/`f.<field>` query parameters; the record schema marks
  system/server-managed fields `readOnly: true`; bulk `PUT`/`DELETE` at
  `/api/{parent}/bulk` declare a `requestBody`; every operation declares
  the real `400`/`401`/`403`/`404`/`409`/`422`/`429` responses its own
  route/service code can actually return (traced to specific template
  lines, not assumed from the status code alone); and `/api/{parent}/
  export`/`/api/{parent}/import` now have their own `paths` entries. A
  sixth gap (per-operation role/permission detail) is deliberately left
  open — the role/permission mapping is runtime database state a static
  generator cannot read, and expressing more than "a 403 is possible"
  would need a new vendor-extension key, left as a separate decision. A
  Spectral/Redocly re-run confirms 0 structural/schema errors and that
  Redocly's `operation-4xx-response` warning (26 occurrences before this
  change) is now zero. See
  `docs/knowledge/generated-documentation-and-openapi-spec.md`.

### Changed
- **Generated specs of an `x-payment` entity now pass without Stripe keys**
  (issue #788). The `test:e2e:cy:*` npm scripts set `PAYMENT_FAKE_STRIPE=1`,
  which makes `lib/payment/stripe_client.ts` hand out a generated in-memory
  Checkout Session fake (`lib/payment/fake_stripe.ts`) and resolve a missing
  Price id to a placeholder. Without the variable the real client is used as
  before, so hand runs against Stripe test keys and production are unchanged;
  with it set in a live environment the client throws instead of faking. An
  adopter can drop an `x-generate.test: false` workaround on its `x-payment`
  entity once its app-generator pointer includes this change.
- **Documented how to run `x-payment` payments locally.** The webhook forwarding
  section of `docs/knowledge/stripe-payment-integration.md` now says what
  happens without `stripe listen` (the record stays `pending`, a cancelled
  reservation is not removed), which port and env file to use (the gitignored
  `.env.test.local` under `NODE_ENV=test`), that the signing secret is stable
  per Stripe account, and how a 400, a refused connection or a 500 shows up.
  The webhook route's missing-secret error and `.env.example` name the right
  file and list all four events.
- **Added a "Production setup" section to the `x-payment` documentation**
  (`docs/knowledge/stripe-payment-integration.md`): what is specific to this
  app in a deployed environment (separate test and live mode objects, a
  `stripe_price_id` on every row that supplies a Price, one webhook endpoint
  and signing secret per environment, the environment variables, and
  `NEXTAUTH_URL` for the Checkout return URLs), with links to Stripe's and
  Vercel's own documentation for the Dashboard steps.
- **`getModelPermissions` (`lib/authz.ts`) now issues one `permission.findMany`
  query per (request, user) instead of one per model queried**, from a
  request-scoped permission-check performance investigation. A cross-entity
  search touching N entities used to fire N separate permission queries for
  the same user; the `name: model` filter is now dropped from the query (a
  new `getPermissionRowsForUser(userId)`, cached by `userId` alone, fetches
  every relevant row across all models in one call) and each caller filters
  the batched result to its own model client-side. Existing 3-branch
  role/global OR clause, and every existing special case (audit_log admin
  bypass, `SELF_ONLY_ADMIN_BYPASS_ENTITIES` no-rows fallback,
  Creator/Assignee aggregation), is unchanged — only how the underlying
  rows are fetched changed, not which rows apply to a given model. See
  `docs/knowledge/performance-improvements.md` §6.

- **Every generated detail/list getter that embeds a relation now opts
  into Prisma's `relationLoadStrategy: 'join'`**, folding what used to be
  one separate query per embedded relation into the main query via a
  database-level JOIN (`previewFeatures = ["relationJoins"]` added to
  `prisma/schema.prisma`'s `generator client` block, and to every gate
  fixture's own schema). Live-DB measurement: `getDashboardDetail`
  dropped from 5 queries to 1, `getOrganizationDetail` from 4 to 1. See
  `docs/knowledge/performance-improvements.md` §7.

- **A column exposed for filtering/sorting in generated UI now gets an
  automatic `@@index`** (issue #726) — any column that appears in an
  entity's `x-display.table` (the generated list page's columns), or is
  referenced by a view's `x-filter-values`, joins the existing
  `creator_id`/`assignee_id`/`organization_id`/FK-column index
  requirement enforced by `validate_prisma_indexes()`. Derived
  mechanically from the schema by a new `derive_ui_exposed_index_columns()`
  (`code_generator/validate.py`) — no hand-maintained column-name list.
  `scripts/add_required_indexes.py` patches `prisma/schema.prisma`
  accordingly; this repo's own dogfood schema needed 8 new indexes across
  6 models (`user.name`, `permission.name`, `dashboard.name`,
  `approval_flow.entity_name`, `approval_request.status`,
  `app_setting.business_date`/`is_pinned`/`timezone`). Distinct from
  issue #742 (ad hoc composite indexes for specific filtered/sorted
  business queries, still deferred pending load-test evidence) — see
  `docs/knowledge/prisma-schema-conventions.md` §5 for how the two
  relate. No consumer-repo migration is included in this change; per the
  standing migration-cadence policy, the actual `@@index` DDL reaches
  each downstream consumer repo only at that repo's own next deploy.

- **Issue #726's UI-exposed indexing requirement no longer applies to
  enum- or boolean-typed columns** — `derive_ui_exposed_index_columns()`
  (`code_generator/validate.py`) excludes a column whose Prisma type is a
  native enum or `Boolean` from the required-index set it derives. This is
  a demo-simplicity decision, not a technical claim that these columns
  never benefit from an index — load-test measurement found that actual
  selectivity of the filtered value, not the column's type, determines
  whether an index helps, and that an enum or boolean column can still see
  a substantial win (e.g. filtering a minority value). Declaring `@@index`
  on such a column is still permitted, only no longer required; existing
  indexes on enum/boolean columns (e.g. `approval_request.status`,
  `app_setting.is_pinned`) are unaffected. See
  `docs/knowledge/prisma-schema-conventions.md` §5.

### Fixed
- **The detail view of an `x-reservation` `mode: item` entity no longer shows
  the allocated foreign key twice** (issue #790). `FormView.tsx` appended a
  raw-id text field for `result.allocatedField` after the normal related-record
  field, and its label rendered as the untranslated key `Fields.room_id`. The
  related record is now shown once; the edit form is unchanged.
- **The `x-payment` stubs no longer reject API keys or send buyers to a 404,
  and the `stripe listen` instructions work with current Stripe CLI versions**
  (issue #776). The generated `app/api/payment/checkout/route.ts` now
  authenticates with `resolveActorId` (API key or session) instead of the
  session only; `app/[locale]/payment/success/page.tsx` and
  `app/[locale]/payment/cancel/page.tsx` are now written, with copy in a new
  `Payment` i18n namespace; `.env.example` and
  `docs/knowledge/stripe-payment-integration.md` give the `--events` form of
  `stripe listen` and note that the CLI is installed separately from the
  `stripe` SDK; and that doc now records the completed Stripe test-mode
  verification instead of calling it pending. `test:payment-gate` also
  type-checks the return pages.
- **A REST update that omitted a relation or child-list field cleared it**
  (issue #777): `PUT /api/{parent}/{id}` and bulk `PUT` passed
  `<field> ?? []` to `update{Parent}`, so, e.g., renaming a role via the
  API removed all of its users, updating a user removed all of their
  roles, and updating a purchase order without `lines` deleted every
  line. CSV import's update path passed `[]` unconditionally with the
  same effect. An omitted field now leaves the relation unchanged; an
  explicitly supplied list (including `[]`) still replaces it. The
  OpenAPI request schemas (`{Parent}CreateRequest`,
  `{Parent}BulkUpdateItem`) now document these fields (`<child>_ids` id
  lists and owned child-row arrays), which were previously absent, so the
  accepted field names were not discoverable from Swagger. See
  `docs/knowledge/generated-documentation-and-openapi-spec.md`.

- **A decimal-kind column's filter crashed on a non-numeric value instead
  of returning zero rows** (found via a real consumer schema): unlike the
  `number`/`date`/`enum` kinds, `buildFilter`'s `'decimal'` branch never
  validated a value before handing it to Prisma's Decimal filter, so a
  malformed query param (e.g. a garbage `f.<field>=` value) crashed with a
  500 instead of dropping the clause. Fixed with the same
  `Number.isNaN(Number(v))` guard every other kind already had. See
  `docs/knowledge/list-filter-sort-typed-columns.md`.

- **Generated list page sort/filter was not column-type-aware** (issue
  #753): an FK/relation display column (e.g. `policy`, `assignee`) was
  silently dropped from every filter/sort request (no error, just a
  no-op), and a native enum, `DateTime`, or `Decimal` column crashed the
  whole page with `PrismaClientValidationError: Unknown argument
  \`contains\`` the moment a user opened its column filter — `buildFilter`
  (`lib/_pagination.ts`) always emitted a generic string `contains` clause
  regardless of the target column's real type, and the flat
  `FILTERABLE_FIELDS`/`SORTABLE_FIELDS` allow-list had no way to represent
  "filter by a relation's labelField" at all. Fixed with a runtime,
  per-column clause-shape dispatch: `buildFilter`/`buildOrderBy` now take a
  `kinds` map (`'string' | 'enum' | 'boolean' | 'number' | 'decimal' |
  'date'`, computed at generate time in `build_context.py` from the same
  `_prisma_native_enum_type`/`_prisma_decimal_type`/`format: date-time`
  markers schema_deriver.py already derives) and a `relations` map (FK
  display columns in `x-display.table` with a simple, single-column
  labelField — composite/dotted labelFields are out of scope) that routes
  a filter/sort through the relation's target column via a nested Prisma
  clause. Every existing plain-string column's behavior is unchanged
  (`kinds[field]` defaults to `'string'`), and the 8 hand-maintained
  built-in-entity `getters.ts` files (dashboard/permission/user/role/
  setting/organization/audit_log/approval_flow) call the old 2-argument
  form unmodified thanks to default parameters. Deliberately scoped to the
  crash/no-op fix only — the MUI filter panel's `operator`
  (contains/equals/after/before/...) is still ignored server-side, so an
  enum/date/number/decimal column always applies one fixed exact-match
  clause per kind regardless of which operator the user picks in the UI; a
  later pass can wire `GridColDef.type` + the real operator through. See
  `docs/knowledge/list-filter-sort-column-type-dispatch.md`.

- **Column-type-aware list filter still crashed for date-only, boolean, and
  invalid-enum-literal values, and never presented the real per-type filter
  control the MUI operator UX implies** (issue #756, follow-on gap in
  #753/#755): (1) `_column_filter_kind()` only recognized `format:
  date-time`, so a plain `format: date` column (`@db.Date`, e.g.
  `effective_date`) fell through to the `'string'` kind and crashed with
  the same `Unknown argument \`contains\`` #753 already fixed for
  date-time; (2) `buildFilter`'s `'boolean'` branch had no value coercion,
  so a real user's only input surface (a plain text box, since no
  `GridColDef.type: 'boolean'` was wired) sent the raw string `"true"` and
  crashed against Prisma's `BoolFilter`; (3) the `'enum'` branch passed an
  unvalidated string straight to Prisma, crashing on any value that wasn't
  independently known to be a valid raw enum literal — including a
  column's own *translated display label* (e.g. `"In Force"` for
  `in_force`), which is what a real user actually sees and types. Fixed
  by extending the scope #753 left explicit ("full `GridColDef.type`/
  operator wiring... for later"): `page_list_context()`
  (`generators.py`) now emits `type`/`valueOptions` per column kind
  (`singleSelect` for enum, reusing the same i18n label source as the
  cell's own display so the two can never drift; `boolean`; `date`/
  `dateTime`; `number` for number/decimal), giving every list page's
  filter panel the real per-type control (a value dropdown, a date
  picker, a checkbox) instead of a plain text box for every column.
  `DataGridClient.tsx`'s `reload()` now forwards the MUI filter panel's
  actual `operator` (previously discarded) to the server; `buildFilter`
  dispatches on it per kind (enum: `is`/`not`/`isAnyOf`, validated
  against a new generate-time `ENUM_MEMBERS` const so an invalid value —
  translated label included — drops the clause instead of crashing;
  boolean: coerced `is`; date: `is`/`not`/`after`/`onOrAfter`/`before`/
  `onOrBefore`; number/decimal: `=`/`!=`/`>`/`>=`/`<`/`<=`; string:
  `contains`/`equals`/`startsWith`/`endsWith`/`isAnyOf`) — an
  unrecognized operator still falls back to that kind's existing default
  clause, never a new crash source. `FilterMap`'s value type widens to
  `FilterValue | { operator, value }`, kept backward compatible:
  `parsePageOpts()` (REST) still emits bare scalars, and the 4 remaining
  hand-maintained built-in-entity `getters.ts` files (dashboard/
  permission/user/role/setting/organization/approval_flow are in fact
  template-generated and already receive the new `kinds` argument like
  any other entity — `audit_log` is the one that still calls the old
  2-argument form, correcting #753's own "8 hand-maintained" count)
  degrade to the pre-existing default clause with no code change. Also
  fixes a real precision bug found only through actual Cypress UI
  interaction, not caught by design review: a `GridColDef.type: 'number'`
  filter's native `<input type="number">` round-trips a typed Decimal
  value through the browser's own IEEE-754 double (`'99.99'` arrives at
  the server as `99.98999999999999488...`), silently breaking exact-match
  filtering against a column whose stored value is exact — a new
  generate-time `DECIMAL_SCALES` const lets `buildFilter` re-quantize a
  JS-number-typed decimal value back to the column's real scale before it
  reaches Prisma. Also extends the same fix to `format: time`
  (Prisma `DateTime @db.Timetz`, previously left untyped and falling
  through to the crash-prone `'string'`/`contains` default like the other
  gaps above): `_column_filter_kind` now dispatches `time` through the
  identical `'date'` clause shape used for `date`/`date-time` unchanged —
  empirically verified that Postgres casts any timestamp-shaped
  comparison value to `timetz` before comparing, discarding its date part
  regardless of what date a full date+time picker attaches, so no
  separate clause shape or date-part normalization is needed —
  and `page_list_context()` wires `type: 'dateTime'` for it (MUI has no
  dedicated time-only `GridColDef` type). This repo's own dogfood schema
  had, and still has, zero enum/boolean/date-only/date-time/decimal/time
  columns anywhere in `x-display.table` to exercise any of this through a
  real list page — rather than adding a fixture entity to this repo's own
  schema for that purpose (an earlier iteration of this change did add
  one, `list_filter_gate`; removed as inconsistent with this repo's own
  fail-closed guard against dogfood test-only entities), coverage is
  template-level regression tests
  (`code_generator/tests/test_list_filter_typed_columns.py`, entity-free)
  plus one-off real-UI verification against an already-real consumer
  entity in a throwaway isolated worktree. See
  `docs/knowledge/list-filter-sort-typed-columns.md`.
- **Generated `addEntity`/`updateEntity` service functions
  (`service.ts.jinja2`) misclassified Prisma's `P2028` error ("Unable to
  start a transaction in the given time" — a transaction/connection-pool
  timeout) as a client-input validation error, returning `422 VALIDATION`
  instead of the existing `409 CAPACITY` error code.** The catch block
  special-cased only `P2002` (unique constraint) before falling through
  every other `PrismaClientKnownRequestError` — P2028 included — into a
  generic `AppError('VALIDATION', 'One or more fields have an invalid
  value')`. `CAPACITY` (409) already existed in `lib/_errors.ts` and was
  already mapped in `lib/api-auth.ts`'s `APP_ERROR_STATUS_MAP`, but
  nothing in the generated service layer ever threw it. Found while
  investigating elevated 422 rates in load testing under high
  concurrency: response bodies for these 422s carried no `field`/`reason`
  key (unlike a real validation failure), and Prisma's own raw error log
  in the same run window showed every one of them was `P2028`. Fixed by
  adding a dedicated `e.code === 'P2028'` branch, mirroring the existing
  `P2002` special case, in both `addEntity` and `updateEntity`. A
  follow-up issue tracks three other codes reaching the same catch-all
  that look similarly misclassified (`P2025`, `P2034`, `P2037`) but were
  kept out of this fix to stay narrowly scoped.

- **`lib/prisma.ts` created a new, independent Prisma Client (and its own
  connection pool) on every module evaluation in production, instead of
  reusing one cached instance per process.** The dev-only `globalThis`
  caching guard (`if (process.env.NODE_ENV !== "production") ...`) assumed
  every production request runs in a fresh process — an assumption that
  breaks under an execution model that evaluates this module's bundle more
  than once within one long-lived process (a warm instance handling
  multiple concurrent invocations, each with its own bundle-scoped copy of
  the module). Empirically confirmed: one process evaluated the module 4
  times across a single login + search flow (route handler, Server Action,
  client-page render, and `instrumentation.ts`'s cold-start hook each
  getting their own bundle-scoped copy), and — before this fix — 3 of those
  4 evaluations held simultaneous, distinct live backend connections,
  multiplying the real per-process connection ceiling by up to 4x beyond
  what `PRISMA_POOL_MAX` alone implies. The cache now applies
  unconditionally in every environment (extracted into a small,
  dependency-free `lib/global-singleton.ts` helper, unit-tested
  independently of the generated Prisma client). Re-measured the identical
  flow after the fix, in the same environment: still 4 module evaluations,
  but exactly 1 real connection pool created and 1 live connection group
  observed throughout.
- **Search/DB-bootstrap code used `$executeRawUnsafe` for statements that
  never needed it, and the generator's own raw-SQL guard couldn't have
  caught a repeat** (issue #737). PR #727 had briefly introduced a
  `tx.$executeRawUnsafe('SET LOCAL pg_trgm.similarity_threshold = ...')`
  call (removed by PR #729 for an unrelated reason); the interpolated value
  was a generate-time constant, never reachable from a runtime request, so
  the call carried no actual injection risk — but `check_generated.py`
  never flagged it, for two independent reasons: its regex required a
  literal `prisma.` receiver (missing a `$transaction` callback param like
  `tx`), and its file-enumeration walk never visited schema-wide generated
  files (`lib/db-init.ts`, `lib/search/helpers.ts`) at all, only per-entity
  ones. Both are fixed, with regression tests. Every remaining
  `$executeRawUnsafe` call with no runtime-supplied value (`lib/db-init.ts`,
  `cypress.config.ts`, `scripts/seed-baseline.ts`) is now the tagged
  `$executeRaw` form instead — empirically confirmed `CREATE INDEX
  CONCURRENTLY` still works correctly (including re-run idempotency)
  through that form. The two pre-existing, legitimate tagged-template raw
  queries this broadened scan now sees (`lib/search/helpers.ts`'s
  cross-entity search UNION, `lib/<entity>/service.ts`'s scheduled-task
  advisory lock) are unchanged and now carry an explicit
  `check_generated_allowlist.yaml` entry. See
  `docs/knowledge/raw-sql-policy.md`.

- **Cross-entity search's trigram/bigm indexes were never used at runtime**
  (issue #725 fix (d)). `generate.py`'s `sim_where_single`/
  `bigm_where_single` wrap every searchable field in `COALESCE(field, '')`
  before applying the `%`/`ILIKE` operators, but `create_gin_indexes.sql.
  jinja2`/`db_init.ts.jinja2` built the trigram GIN index on the bare
  column — a GIN index only matches a query expression syntactically
  identical to the one it was built on, so the index was permanently
  unusable regardless of cold-start state or data volume. Confirmed via
  `EXPLAIN ANALYZE` on a 60,000-row table: the real generated predicate
  forced a full-table `Seq Scan` (`Disabled: true` even with
  `enable_seqscan = off`), 582ms for a single-row-match query, vs. 0.4ms
  (`BitmapOr` over `Bitmap Index Scan`s) once fixed. Fixed by adding a
  second, `_v2`-suffixed expression index per field matching the query's
  `COALESCE(field, '')` form verbatim — query-side (`generate.py`) is
  untouched, so no search-result behavior changes for any entity. The old
  bare-column index is left in place (dead weight, harmless) to avoid a
  blocking `DROP INDEX`; removing it is a separate, non-urgent follow-up.
  Also reconciled an unrelated pre-existing drift between the two index
  templates (different index name and field set for what was meant to be
  the same index) found while implementing this fix. See
  `docs/knowledge/search.md`.

- **`prj:sync` could silently drop a generator-side Prisma model/field
  when a consumer's `prj/prisma/schema.prisma` predated it** (issue
  #646). `prj:sync` copies `prisma/schema.prisma` from a consumer's
  `../prj` verbatim over this generator's own file; when this generator
  adds a new `model` or field (e.g. the `idempotency_key` model and
  `user.api_key_expires_at` field added at commit `f06d2a0b`), a
  consumer whose `prj/prisma/schema.prisma` was captured before that
  addition would have it silently reverted away on the next sync, with
  no warning — confirmed to have happened identically across
  app-template, insurance-app, and inventory-app. `scripts/prj_sync.py`
  now diffs the destination's current model/field set against the
  incoming consumer file before overwriting `prisma/schema.prisma`;
  when the incoming file is missing generator-side content, the copy
  for that file is skipped (destination left untouched) and the run
  exits non-zero naming exactly what would have been dropped, rather
  than proceeding silently. Content present only in the consumer's file
  (its own models/fields) is never flagged. See
  `docs/knowledge/prj-sync-schema-drop-guard.md`.

- **Cross-entity search could fail with `P2028` (transaction timeout) at
  real data scale**, a regression from the issue #725/#727 GIN-index fix
  above: `buildSearchQuery()` wrapped its count/facet/main-select queries
  in `prisma.$transaction(...)` with no explicit `timeout`, so Prisma's
  5000ms default applied — at N=30,000 scale the full 25-entity search
  UNION could exceed 5000ms end-to-end (reproduced 3/3 times against a
  clean test database with no other load). Checked directly against a live
  Postgres instance (`SHOW pg_trgm.similarity_threshold;` /
  `pg_settings.source`): the GUC the `%` operator reads its threshold from
  already defaults to 0.3 — identical to the generator's own constant, with
  no per-schema override that could ever set it differently — so the
  `SET LOCAL`/transaction wrapper was defensive scaffolding for a case that
  cannot occur today. Removed the transaction entirely; count, facet, and
  main select now run as three independent queries via `Promise.all`
  (each its own pooled connection), restoring and improving on the
  pre-#727 parallel behavior (measured ~35-55% faster than pre-#727 at the
  same data scale, since the GIN index is now actually used) with zero
  P2028s across 5 repeated runs post-fix. See `docs/knowledge/search.md`.

- **List-page pagination (`get{Parent}Page()`) could fail with `P2028`
  (transaction timeout) under concurrent load at real data scale**, a
  separate failure mode from the search fix above with the same root
  shape: `findMany`+`count` were bundled into `prisma.$transaction([...])`
  (the batch/array form), which needs to acquire connections for both
  member queries atomically before either can start — Prisma's default
  `maxWait` for that acquisition step is 2000ms (confirmed via
  `@prisma/client/runtime/client.d.ts`'s `PrismaClientBaseOptions
  .transactionOptions` doc comment: `"maxWait ?= 2000"`). Under
  `PRISMA_POOL_MAX=5` with concurrent search load also competing for
  pooled connections, the batch transaction could not always acquire both
  connections within 2000ms — reproduced at N=30,000 scale: `GET
  /api/policy` 21.55% error rate, `GET /api/service_request` 22.10%,
  `DELETE /api/provider/:id` 20.59%, while list/detail endpoints without
  this transaction wrapper stayed at 0% error under the identical load.
  Removed the transaction wrapper; `findMany` and `count` now run as two
  independent queries via `Promise.all` (each its own pooled connection,
  acquired independently instead of atomically) — confirmed zero P2028s
  across the full API and UI Cypress suites post-fix. This trades exact
  `findMany`/`count` snapshot consistency (already an accepted trade for
  every non-transactional list/detail read path) for eliminating the
  `maxWait` bottleneck. See
  `docs/knowledge/performance-improvements.md` §5.

- **GCP (Cloud Run) deployment required manually pasting Neon connection
  strings, had no committed env template, could silently pick up a stale
  ambient `gcloud` project, and printed a deploy-complete URL that 404s**
  (issues #685, #683, #686) — `scripts/gcp-env.sh` now falls back to the
  `DATABASE_URL_PROD`/`DATABASE_URL_UNPOOLED_PROD` values `scripts/vercel-
  setup.sh` already writes into the same `.env.production.local` (no manual
  Neon console lookup needed when a Vercel deployment for the same app
  already exists), warns loudly and names the resolved project when
  `PROJECT_ID` falls back to the ambient `gcloud config` state instead of
  silently reusing it, and a new `.env.gcp.production.local.example`
  template is committed (renamed from the never-committed
  `.env.production.local.example` both `gcp-env.sh` and `vercel-env.sh`
  referenced in their error messages, which collided with the unrelated
  `.env.vercel.production.local.example` when a consumer symlinked the
  generic name). `scripts/gcp-deploy.sh`'s final "Deploy complete" message
  now also prints a `/en/login` link, since the bare Cloud Run origin URL
  404s without a locale prefix (the i18n middleware's root-path redirect
  behavior is unchanged and correct — Vercel deployments hit the exact same
  307 redirect — this is a printed-message fix only). All three traced to
  root cause via direct commit inspection: the Neon-paste requirement was
  introduced by PR#617 (2026-09-18, Cloud SQL→Neon reconnection) as an
  explicit, acknowledged scope cut; the stale-project fallback and missing
  template predate PR#617 (present since the first GCP automation commit,
  2026-07-02).

- **Cross-entity search's GIN/trigram indexes were never actually created,
  and the generated query would not have used them even if they were**
  (issue #725, found via load testing at N=30,000-row realistic scale —
  every entity in the search UNION ran a full table scan, 130-250ms
  per-entity). Three parts, all required together (confirmed empirically —
  any one alone leaves search performance unchanged):
  1. A new generated `instrumentation.ts` calls `lib/db-init.ts`'s
     `ensureSearchIndexes()` from Next.js's `register()` hook on every
     server cold start (Vercel and GCP/Cloud Run both reach it, since both
     dispatch through this same Next.js mechanism) — previously this
     function had no call site anywhere in the generated output.
     `scripts/create-gin-indexes.sql` (manual `psql` application) remains
     as a fallback.
  2. The generated search predicate's fuzzy-match half changed from
     `similarity(field, query) > threshold` to the `field % query` operator
     form, with `SET LOCAL pg_trgm.similarity_threshold` scoping the
     threshold to the enclosing `prisma.$transaction(...)` — the
     function-call form is opaque to the Postgres planner and never uses a
     trigram GIN index, regardless of whether the index exists; only `%` is
     recognized as trigram-indexable.
  3. `create_gin_indexes.sql.jinja2` and `db_init.ts.jinja2` now also
     create a GIN index on the `to_tsvector(...)` expression itself (not
     only the trigram index) — the FTS half of the search predicate had no
     backing index of any kind before this. Both mechanisms use `CREATE
     INDEX CONCURRENTLY IF NOT EXISTS` throughout (non-blocking, cheap
     no-op once the index exists).

  See `docs/knowledge/search.md`.

## [4.1.0] - 2026-09-19
### Added
- **Added a business-date container (`app_setting`) with list/view/new/edit
  screens and a REST API** (PR #611), built on top of the existing hand-written
  `business_date`/`is_pinned`/`timezone`/`organization_id` Prisma model.
  `organization_id` is optional and left out of `required`, so the existing
  org-relationship-optional machinery makes each row visible both to its
  own organization and to every tenant — a query returns the actor's own
  organization row when one exists, plus the tenant-wide default
  (`organization_id: null`). Delete is disabled
  (`x-generate.delete: false`): the sole default row must not be removable
  through the standard entity delete action. `scripts/seed-baseline.ts`
  seeds the tenant-wide default row.

### Changed
- **Upgraded PostgreSQL from 16 to 18** across all three compose files
  (dev/test/prod) and `docker/Dockerfile.postgres` (issue #610).
  PostgreSQL 18's official image requires a single mount at
  `/var/lib/postgresql` rather than a direct mount at
  `/var/lib/postgresql/data` — its entrypoint refuses to start otherwise —
  so the compose volume mount lines were updated accordingly for all three
  files. GCP deployment script version pins were intentionally left
  untouched in this change; that migration was tracked separately (see the
  Cloud Run/Neon entry below).

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

- **`app_setting`'s `organization` relation was declared one-to-many
  (`app_settings app_setting[]`) while `@@unique([organization_id])`
  constrains it to one-to-one** (issue #681) — `organization.app_setting`
  is now a singular, optional relation field (`app_setting?`), and
  `code_generator/json_schema.yaml`'s `organization_id` FK now declares
  `x-relationship: {type: one-to-one, target: organization}`, which also
  makes the New/Edit page's organization picker exclude organizations that
  already have an `app_setting` row. Fixing this surfaced a related
  generator bug: `build_context.py`'s `has_org_rel`/`org_id_client_writable`
  scanned a relationship list that excludes one-to-one FKs, so marking the
  organization FK as one-to-one silently turned off org-isolation
  (`should_filter_by_org`) for `app_setting` while the Cypress
  test-generation path kept generating cross-org-isolation tests expecting
  it enforced — both now scan the same unfiltered relationship list. No
  migration/DDL impact (no migration for `app_setting` has been cut in this
  repo yet; the fix is Prisma relation metadata only).

- **The GCP Cloud Run deployment path still provisioned and connected to a
  Cloud SQL instance** (PR #617) — `scripts/gcp-setup.sh`/
  `scripts/gcp-deploy.sh` now retire Cloud SQL provisioning entirely;
  `DATABASE_URL` (pooled) and a new `DIRECT_URL` (unpooled) are supplied via
  `.env.production.local` instead of being derived from a Cloud SQL
  instance, and the `app-migrate` Cloud Run Job now carries `DIRECT_URL` so
  `prisma migrate deploy` runs against Neon's unpooled endpoint, never the
  pooled one (see `docs/knowledge/prisma-direct-vs-pooled-connection.md`
  for why a transaction-mode pooler must not run migrations).
  `docs/knowledge/gcp-automation-design.md` is substantially rewritten for
  the Neon-based flow. **Note**: TLS/network reachability from Cloud Run to
  Neon was not empirically verified as part of this change — there was no
  live GCP deployment of this app to test against at the time; that
  verification is deferred to the next actual GCP deployment.

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
