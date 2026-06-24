# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [1.5.0] - 2026-06-24

### Added
- **Cross-entity full-text search** (`x-generate.search: true`) via PostgreSQL FTS + pg_trgm + pg_bigm:
  - `GET /api/search` REST endpoint generated when searchable entities exist; UNION ALL query across all opted-in entities with tenant and permission filters applied per entity
  - `app/[locale]/search/page.tsx` global search UI (mobile-responsive client component) with search box, entity-type chip per result, snippet, and "View details" link
  - Japanese 2-gram search via pg_bigm extension (custom Docker image `app-postgres-bigm:16`; GIN bigm indexes via migration)
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
- **`x-ui.rows`** — textarea row count is now schema-driven for any string field via `x-ui.rows: N` in the schema; previously only `description` fields had a hardcoded 4-row default. Without `x-ui.rows`, the existing `description`→4 convention is preserved
- **`set_fields` type-awareness** — `on_approved.set_fields` resolves enum labels to integer indices when the target field type is `integer`, fixing TypeScript build errors on generated dispatch files
- **Mobile header** — Setting link and Sign Out button hidden on mobile (`md:hidden`) to prevent header overflow; a mobile-only account section (Setting + Sign Out) added to the sidebar drawer with an `<hr>` separator

### Fixed
- pg_bigm WHERE clause: replaced incorrect `%%` operator with `LIKE '%'||q||'%'` containment (pg_bigm `=%` uses padding bigrams and fails for mid-string Japanese; LIKE containment is GIN index-accelerated and reliable)
- Search authorization: fixed `perms.permissions.read` (merged flag) → `perms.permissions.general.read` in search WHERE generation; creator-only users no longer see all rows
- Schema contamination: restored `json_schema.yaml` (730 lines) after testbed entity definitions (2 367 lines) leaked in via `prj:sync`; also restored `user_detail.search:false` and `setting.search:false` security flags

> **Backward compatibility**: Non-breaking from v1.4. Existing schemas work unchanged. Cross-entity search is opt-in per entity (`x-generate.search: true`). Approval event dispatch requires `x-approval.on_approved` in the schema to activate. No breaking changes.

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

> **Backward compatibility**: Non-breaking from v1.3. Existing schemas work unchanged; comment reactions and the generalized bridge are opt-in. No breaking changes.

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
- Deep labelField Prisma include merge: fixed the issue that relations with nested `label_field` are not merged correctly (commit 7aab3c9)。

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
