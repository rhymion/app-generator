# Rhymion App Generator — Schema-Driven Web Application Generator

Generate production-ready web applications from YAML schema definitions. Describe your data model and screen layout once — the generator produces a complete Next.js application with full CRUD pages, REST API, role-based access control, tenant-aware backend, and multilingual support.

Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), and [MUI](https://mui.com/).

> **Upgrading from an earlier version?** See [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md) for the 3.0 breaking changes and migration steps.

---

## Features

### Code Generation

- **Schema-driven generation** — YAML schema (`code_generator/json_schema.yaml`) + Prisma schema → TypeScript, React, and Cypress files via a Python pipeline
- **Full CRUD pages** — list, view, create, edit, and delete pages generated per entity
- **Gantt chart views** — entity-level opt-in Gantt chart pages
- **REST API** — JSON endpoints with API key authentication generated per entity
- **Generated Cypress tests** — UI and API test suites generated alongside application code
- **Dashboard charts** (`x-display.dashboard: true`) — column, bar, line, and pie chart rendering with stacking modes, timestamp bucketing, typed multi-condition filters, CSV/Excel export, and a REST aggregate endpoint (`/api/{entity}/aggregate`) generated per entity
- **Inventory reservation** (`x-reservation`) — opt-in capacity/inventory reservation; `count` mode reserves a numeric counter column, `item` mode locks rows via an `inventory_allocation` bridge table
- **Wrapper component architecture** — generated per-entity components use shared wrappers in `components/_standard/` (statically provided; not overwritten by re-runs) and generated components import shared `App*` wrappers from `components/ui/` instead of `@mui/*`, so auto-generated code no longer depends on MUI directly (provider setup excepted)
- **Cross-entity full-text search** (`x-generate.search: true`) — `GET /api/search` REST endpoint and a global search UI page (`app/[locale]/search/page.tsx`) generated when searchable entities exist; UNION ALL across opted-in entities with per-entity tenant and permission filters; Japanese 2-gram search via pg_bigm; facets (hit counts per entity type) and XSS-safe snippet highlight
- **`x-ui.rows`** — textarea row count for any string field controlled via `x-ui: { rows: N }` in the schema
- **FK scalar auto-inference** — FK scalar columns (e.g. `organization_id`) no longer need to be declared explicitly in `code_generator/json_schema.yaml`; the generator derives them from Prisma relation properties
- **FK autocomplete custom filter hook** (`autocomplete_filter_stub.ts.jinja2`) — per-entity once-stub for narrowing autocomplete and list results beyond the built-in permission filter

### Relationships

- Many-to-one, many-to-many, one-to-one, and self-referential relationships
- Inline DataGrid children and embedded lists
- Independent children with their own pages
- **Generalized bridge pattern** — reusable schema-level bridge for real one-to-one and polymorphic relations via an internal through-table (`<model>able`); no extra FK columns on the parent, parent autocomplete preserved, and internal bridge tables omitted from JSON schema output

### Authentication & Authorization

- Email/password authentication
- Google SSO (Auth.js v5)
- Account linking (multiple OAuth providers per user)
- Role-based access control (per-model CRUD permissions)
- Creator/Assignee-based access control
- `x-self-only` — permission-independent per-user data isolation: unlike Creator/Assignee scoping (a configurable option a permission grant can widen), `x-self-only` entities restrict every row to its own creator unconditionally, with an optional audited admin bypass (`admin_bypass: true`) for a privileged role; see [`docs/knowledge/self-only-entity.md`](docs/knowledge/self-only-entity.md)
- `x-filter-values` — view-scoped row restriction: `{ field: [allowed values, ...], ... }` (AND across fields, IN per field) limits a view to a subset of its underlying model's rows, enforced unconditionally across list/detail/export/search reads and update/delete writes (pre-image-judged, so a legitimate transition out of the filtered view still succeeds); see [`docs/knowledge/filter-values-row-scope.md`](docs/knowledge/filter-values-row-scope.md)
- Organization-based access scoping — entities with organization_id are automatically filtered to organizations the user belongs to, including CSV import's dotted natural-key FK lookups (e.g. `role.name`) when the lookup target is itself organization-scoped; see [`docs/knowledge/csv-import-dotted-fk-org-filter.md`](docs/knowledge/csv-import-dotted-fk-org-filter.md). An `organization` relationship may itself be declared optional (removed from `required`) rather than mandatory — see [`docs/knowledge/org-optional-entity-support.md`](docs/knowledge/org-optional-entity-support.md)
- CSV import for FK columns whose display label is composite or dotted (e.g. joined from multiple related fields) — resolved by matching the full rendered label text against a pre-built lookup map (row-level `NOT_FOUND`/`MULTI_MATCH` errors, org-isolation-aware); see [`docs/knowledge/csv-import-composite-labelfield.md`](docs/knowledge/csv-import-composite-labelfield.md)
- Graceful degradation for foreign-key read-permission gaps — if a role can create/edit an entity but lacks read on one of its FK targets (e.g. can manage `approval_flow` but not `role`), the affected field renders disabled instead of crashing the page; see [`docs/knowledge/fk-read-permission-graceful-degradation.md`](docs/knowledge/fk-read-permission-graceful-degradation.md) when assigning permissions
- `x-server-value` — a field whose value is always server-computed (currently `source: actor`, the authenticated user's id), never client-writable, and automatically read-only. The dict form adds optional delegation: `{source: actor, override_permission: <Operation>}` lets an actor holding that permission supply an explicit value on create (e.g. an admin filing something on someone else's behalf); anyone else's submitted value is silently replaced with their own id rather than the request failing, with an optional `_server_value_overrides` response flag so a caller can detect it. Plain `x-readonly`/`x-readonly-fields` fields (no delegation) are hard-rejected if a client submits any value for them on create — CREATE has no persisted row to compare against the way PUT does, so unlike an update mismatch there is no legitimate fallback value. See [`docs/knowledge/x-server-value-actor-delegation.md`](docs/knowledge/x-server-value-actor-delegation.md)

### Built-in Systems

- **Comment threads** — polymorphic bridge pattern for attaching comments to any entity, with reaction buttons (toggle endpoint, batched aggregation, parent-owner read authorization)
- **Attachment management** — file and image upload via polymorphic bridge; image/file previews can be opted out independently per entity (`AttachmentSection` `showImages`/`showFiles` props, both default `true`)
- **Inventory reservation** — schema-level `x-reservation` for capacity and inventory management (count and item modes); lifecycle transitions for the owning entity go through the Approval Flow System's approve/(terminal) reject rather than a bespoke reservation-lifecycle mechanism
- **Inventory ledger** (`x-ledger-source`) — an `inventory_transaction` ledger entity and `transactionable` bridge, generated when a ledger top-level declaration is present in the schema; annotate a receiving-receipt or billing-detail entity with `x-ledger-source` to emit write/adjust/move stub templates
- **Split action** (`x-splittable`) — annotate an entity to generate a split-action UI section and API route for lot-level split operations from the list or edit page
- **Dashboard charts** — per-entity chart widgets (column, bar, line, pie) generated from schema; stacking modes, time bucketing, typed filters, CSV/Excel export, and REST aggregate endpoints
- **Cross-entity search** — `GET /api/search` with UNION ALL across searchable entities; facets, highlight, Japanese pg_bigm support; header search icon and full search page generated
- **Approval event dispatch** — post-approval hooks (`x-approval.on_approved.set_fields`, `x-approval.on_approved.emit_hook`) with fire-once idempotency via `approvable.approved_at`; `x-approval-lines` generates matching pre-/post-create helpers that wire approval-line entities to inventory ledger operations
- **Declarative write-locked values** (`x-write-locked-values`) — annotate an entity with `{field_name: [value, ...]}` to reject a plain create/update that writes one of those values directly (screen, REST API, Server Action, and CSV import all enforce it), while still rendering the value as a disabled — not hidden — form option; composes with `x-approval`'s own locked values as a union, so a field can be protected by either or both mechanisms at once, with no schema-authoring dependency between them; see [`docs/knowledge/x-write-locked-values-field-lockdown.md`](docs/knowledge/x-write-locked-values-field-lockdown.md)
- **Declarative state-transition lockdown** (`x-state-lockdown`) — annotate an entity with `{field, terminal_values, locked_fields}` to block a monitored enum field from moving away from a terminal value and to freeze a designated set of other fields once that terminal value is reached (screen, REST API, Server Action, and CSV import all enforce it, same-value resubmission always allowed); `x-approval`-independent — no `x-approval` block required at all; see [`docs/knowledge/x-state-lockdown-transition-lockdown.md`](docs/knowledge/x-state-lockdown-transition-lockdown.md)
- **Terminal rejection** (`x-readonly-fields`) — annotate fields to lock them once an entity reaches a terminal rejected state; rejection fires a once-stub (`service_after_reject_stub.ts`) via `on_rejected_dispatch` for custom post-rejection logic (e.g. notifications, inventory adjustments)
- **Stripe payments** (`x-payment`, opt-in) — declaring `x-payment: true` on any entity generates write-once stubs for Stripe Checkout Session creation and webhook handling (`lib/stripe.ts`, `app/api/payment/checkout/route.ts`, `app/api/webhooks/stripe/route.ts`), fail-closed on missing secrets; one-time purchases only, no entity/authz/UI generated — see [Payments](#payments-stripe-opt-in) below

### Performance

- Streaming Suspense for fast TTFB
- Skeleton screens during loading
- Parallel data and permissions fetching
- Configurable query timeout on the direct-connection path (`STATEMENT_TIMEOUT_MS`, default 30s, `0` disables)
- Automatic FK index coverage (`@relation` columns) and a generated pg_trgm GIN index script for search
- Search `COUNT(*)` opt-out (`SearchOpts.count: false`) to skip both count queries on large result sets

### Security

- Rate limiting (Redis with in-memory fallback)
- CSRF protection
- Parameterized queries via Prisma

### Deployment

- **GCP Cloud Run** (`x-cloud` annotation, opt-in) — multi-stage `Dockerfile`, GCS-backed uploads (Signed URL upload + proxy routes), and idempotent environment automation scripts (`gcp-env.sh`, `gcp-setup.sh`, `gcp-deploy.sh`, `gcp-seed.sh`, `gcp-teardown.sh`); Vercel remains the default when `x-cloud` is not set

### Audit & Compliance

- **Audit log** — schema-agnostic, read-only viewer (`app/[locale]/audit_log/page.tsx`) over all generated entities' create/update/delete actions
- **GDPR / data protection** — `x-pii` field classification (`direct`/`sensitive`/`indirect`), an `anonymizeUser()` erasure function, `x-gdpr-mode` data-subject-scope classification (`internal`/`consumer`/`both`; schema-validated, not yet consumed by codegen), AES-256-GCM at-rest attachment filename encryption, and `x-mention` user-mention parsing in comments
- **Terms of Service / Privacy Policy** (`/[locale]/legal/terms`, `/[locale]/legal/privacy`) — Markdown template documents linked from the registration page; adding a document language is dropping a `content/legal/<doc>.<locale>.md` file, independent of the site's UI locale list (see `docs/knowledge/legal-documents.md`)

### Other

- Internationalization (English and Japanese, next-intl v4)
- Dark mode (system-aware, SSR-safe)
- 5 extension points for customization without overwriting generated code

---

## Roadmap

These features have partial implementations and are under active development.

### Multi-tenancy (Tenant-level isolation)
**What works:** The `tenant` model exists with name, slug, and status
fields (Phase 1.1). Every user has a `tenant_id` linking them to a
tenant (Phase 1.2). Organization-scoped filtering (a separate, working
feature) provides sub-tenant data grouping.

**What's missing:** Generated code does not filter by `tenant_id`.
Phases 1.3–4.3 of the multi-tenancy roadmap are not yet implemented:
tenant resolution in auth sessions, tenant-aware code generation
templates, cross-tenant isolation tests, and invite-only sign-up.
Users from different tenants in the same deployment can currently
access each other's data. The full phased plan was removed as a
planning doc in commit b11269b; recover it via
`git show b11269b^:docs/multi-tenancy.md`.

### MFA / Two-Factor Authentication

**What works:** TOTP authentication logic, encrypted secret storage
(AES-256-GCM), and recovery codes (8 per enrollment, bcrypt-hashed)
are implemented in `lib/mfa/`. Self-service enrollment and disable are
available at `/setting/mfa`.

**Note:** Recovery codes can be entered in the standard MFA code field at login.
There is no separate recovery-code-only screen; the same code input accepts
both TOTP codes and recovery codes.

### Approval Flow

**What works:** Full approval workflow with configurable flows
(`approval_flow`), status tracking (`pending`/`approved`/`rejected`/
`terminal_rejected`), audit trail (`approval_history`), role-based
approve/reject permissions, post-approval event dispatch
(`x-approval.on_approved.set_fields` for field updates,
`x-approval.on_approved.emit_hook` for custom logic via a generated
`service_after_approve.ts` once-stub), and rejection event dispatch
(`on_rejected_dispatch`, paired with a `service_after_reject_stub.ts`
once-stub). `x-readonly-fields` locks specified fields once an entity
reaches the terminal rejected state.

**What's missing:** Complex multi-step orchestration (e.g., chaining
approvals to external workflows or automatically kicking off reservation
changes) requires custom logic in the once-stubs.

---

## Architecture Overview

The core of this project is a Python code generation pipeline. A single YAML schema file drives generators that emit TypeScript, React, and Cypress files.

```
code_generator/json_schema.yaml
        │
        ▼  npm run generate-code
        │
        ├── generate_types.py    — entity extraction
        ├── build_context.py     — base context builder
        ├── generators.py        — page/service/column_def/chart contexts
        ├── generators_i18n.py   — i18n message keys + next-intl config
        ├── generators_test.py   — Cypress helper/spec/api-spec contexts
        ├── generators_doc.py    — docs entity/index pages
        ├── validate.py          — schema + Prisma index validation
        └── templates/*.jinja2   — Jinja2 templates (one per output file type)
```

For each entity defined in `code_generator/json_schema.yaml`, the pipeline generates CRUD pages, service/getter modules, API routes, Cypress test specs, and entity documentation. All generated files are overwritten on each run — customizations belong in the designated extension points (`lib/{entity}/service_validation.ts`, `components/_standard/`, `custom/`).

See [docs/knowledge/architecture-overview.md](docs/knowledge/architecture-overview.md) for the full pipeline reference and generated-vs-hand-written boundary documentation.

---

## Getting Started

### Prerequisites

| Tool | Purpose | Minimum version |
|------|---------|----------------|
| [Git](https://git-scm.com/downloads) | Clone the repository | any |
| [Node.js](https://nodejs.org/) | Run the Next.js application | 20 LTS |
| [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) | Install JavaScript dependencies | 10 |
| [Python 3](https://www.python.org/downloads/) | Run the code generator | 3.10+ |
| [pip](https://pip.pypa.io/en/stable/installation/) | Install Python dependencies | any |
| [Docker](https://docs.docker.com/get-docker/) | Run PostgreSQL and Redis containers | any |

### Install

```bash
git clone git@github.com:rhymion/app-generator.git
cd app-generator

# JavaScript dependencies
npm install

# Python dependencies
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Configure AUTH_SECRET (required)

`AUTH_SECRET` is required — Auth.js will fail with a `MissingSecret` error if it is not set.

Generate a secret:

```bash
openssl rand -base64 32
```

Add the output to `.env.development` (for local dev) and `.env.test` (for E2E tests). For production, set it in the Vercel dashboard.

### Quick Start (One Command)

After installing dependencies, a single command starts the database, generates code, runs migrations, seeds, and launches the dev server:

```bash
npm run dev:full
```

`dev:full` runs: `docker:up:dev` → `generate-code` → `migrate:dev` → `db:generate` → `db:seed-baseline` → `dev`

For a production build:

```bash
npm run build:full
```

`build:full` runs: `docker:up:prod` → `generate-code` → `migrate:deploy` → `db:generate` → `db:seed-baseline` → `build`

> **Important**: Before running `build:full` for the first time, run `dev:full` at least once. `dev:full` uses `migrate:dev` to create Prisma migration files; `build:full` uses `migrate:deploy` which only applies existing ones.

Or follow the step-by-step instructions below.

### Start the Development Database

```bash
npm run docker:up:dev    # starts postgres-dev (port 5433, DB: my_next_dev)
```

### Generate Code, Push Schema, and Seed

```bash
npm run setup            # generate-code → db:push → db:generate → db:seed-baseline
```

### Start the Development Server

```bash
npm run dev              # Next.js dev server on port 3001
```

Open [http://localhost:3001](http://localhost:3001) to see the application. After the server starts, visit [http://localhost:3001/docs](http://localhost:3001/docs) to browse generated entity documentation (English only).

```bash
npm run docker:down:dev  # stop the database when done
```

---

## Usage as a Base Project

To use this generator as the foundation for your own application, see [app-template](https://github.com/rhymion/app-template). It is a thin wrapper that takes app-generator as a submodule and adds your project-specific schema definitions and custom code on top.

---

## Built-in Systems

### Approval Flow

Multi-step, role-based approval workflows with status tracking (`pending`/`approved`/`rejected`/`terminal_rejected`) and a full audit trail. Approval and terminal rejection both dispatch once-stub hooks (`x-approval.on_approved`, `on_rejected_dispatch`) for downstream logic such as field updates or inventory adjustments; `x-readonly-fields` locks fields after a terminal rejection. See the Roadmap section for what's still missing (multi-step cross-workflow orchestration).

See [docs/knowledge/appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md).

### Comment Threads

A polymorphic bridge pattern allows comment threads to be attached to any entity without schema changes to each entity. Comments are displayed inline on view pages, and each comment supports reaction buttons (a per-comment toggle endpoint with batched aggregation and parent-owner read authorization).

Any comment field annotated `x-mention: true` also gets `@mention` support: an org-scoped candidate picker (`MentionInput`), GDPR-safe id-based storage (`@[user_id:<id>]`), a permission-aware profile-linking renderer (`MentionText`), and a notification to newly-mentioned users (self-mentions excluded; edits only notify on newly-added mentions). Any other field annotated `x-mention: true` on any entity also gets the `MentionInput` picker on its edit form.

See [docs/knowledge/appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) and [docs/knowledge/mention-system.md](docs/knowledge/mention-system.md).

### Attachment Management

File and image upload via a polymorphic bridge, backed by Vercel Blob by default (GCS-backed when `x-cloud` GCP deployment is enabled — see [Deployment](#deployment)). Any entity that opts in receives a file attachment panel on its view page. Image and file previews can each be hidden independently per entity (`AttachmentSection` `showImages`/`showFiles` props, both default `true`).

### Inventory Reservation, Split & Receiving

Generic primitives — `x-reservation`, `x-splittable`, `x-ledger-source` — that any entity can opt into; not inventory-specific. `x-reservation` covers two roles: inventory allocation (`count` mode, reserving a quantity out of a numeric pool) and specific-resource reservation (`item` mode, e.g. reserving a hotel room). `x-splittable` divides a line item into parts, each drawing from an explicit or auto-allocated pool row. `x-ledger-source` generates an `inventory_transaction` ledger entity plus write/adjust/move stub templates for receiving-receipt or billing-detail entities. Approval and rejection of the owning entity go through the Approval Flow System above, not a bespoke reservation lifecycle.

See [docs/knowledge/appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md).

---

## Security

**Rate limiting** is handled by `getRateLimiter()` in the API middleware. In development (no `REDIS_URL`), it falls back to an in-memory limiter automatically. In test and production environments, it uses Redis.

**CSRF protection** is applied to all state-changing API routes.

**Organization-scoped filtering** is applied at the query layer: every list query applies an automatic `organization_id` filter, scoping data to the authenticated user's organization. Mutation paths (update/delete/CSV-import-update) on organization-scoped entities also deny cross-organization access by ID — a request targeting another organization's record resolves to a deny (`404` on API routes, silent no-op on session actions) rather than succeeding on `creator_id`/`assignee_id` permission alone. If an organization-scoped entity's own `organization` relationship is declared *optional* (not in `required`), a row with no organization is treated as unassigned rather than invisible — it's admitted alongside the user's own organizations in every read/write scope filter, not excluded by them, so it remains reachable by any authenticated actor with the relevant permission rather than becoming orphaned the moment it's created without an organization. Tenant-level isolation (cross-tenant data separation) is not yet implemented — see the Roadmap section.

**Role-based access control** is defined per-model in the schema. The `authz.ts` module enforces per-model CRUD permissions on every request.

**Default-deny**: new users start with zero permissions. An Administrator must explicitly assign roles to grant access. The `Administrator` role (seeded by `seed-baseline.ts`) grants full CRUD on all entities. See [docs/knowledge/authorization-default-deny.md](docs/knowledge/authorization-default-deny.md) for the permission model and test classification rules.

**Unauthenticated page requests** are redirected to `/login` by `proxy.ts` before any page renders, and the user is sent back to their original destination after signing in (open-redirect protected — off-site `redirect` values are rejected). API routes are unaffected and continue returning JSON `401`/`404`. See [docs/knowledge/unauthenticated-page-redirect.md](docs/knowledge/unauthenticated-page-redirect.md).

**Generated permission E2E coverage** includes per-entity permission-denial tests (GET/POST/PUT/DELETE/export/import, 4xx) and cross-organization isolation tests (create/update/read blocked across org boundaries) in `cypress/e2e/api/<entity>.cy.ts`. See [docs/knowledge/permission-e2e-test-design.md](docs/knowledge/permission-e2e-test-design.md).

See [docs/knowledge/multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md).

---

## Audit & Compliance

**Audit log** — a schema-agnostic, read-only viewer (`app/[locale]/audit_log/page.tsx`) over the `audit_log` model, showing create/update/delete actions across all generated entities. `lib/audit_log/getters.ts` resolves the actor user via FK join and paginates via `CardListPagination`; the raw `metadata` JSON is shown only on the admin-only detail page. The `audit_log` model's columns predate 2.0.0, but the `actor_user` relation it joins through (and its `onDelete: Restrict` foreign key) is new in 3.0 — see [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

**GDPR / data protection**:
- `x-pii` field classification (`direct` / `sensitive` / `indirect`) drives which fields `anonymizeUser()` scrubs on erasure (GDPR Art. 17 right to erasure). The scrub is transactional and irreversible; it does not delete the user row, to preserve referential integrity, and records `anonymized_at` on the `user` model.
- `x-gdpr-mode` (`internal` / `consumer` / `both`) classifies a model/field's data-subject scope for compliance bookkeeping. It is schema-validated (`code_generator/validate.py`) but not yet read by any codegen template — no effect on generated code as of 3.0.
- Attachment filenames are encrypted at rest with AES-256-GCM (`lib/compliance/attachment_name_crypto.ts`).
- `x-mention` enables `@[user_id:uuid]` mention syntax in comments, with generated mention-parser utilities.

---

## Payments (Stripe, opt-in)

Not a default-schema feature. Declaring `x-payment: true` on any entity in
`json_schema.yaml` causes `generate-code` to write three write-once stub
files the first time it runs (same convention as
`lib/<parent>/invalidate_handler.ts` — edits survive regeneration):
`lib/stripe.ts` (SDK init, fails closed if `STRIPE_SECRET_KEY` is unset),
`app/api/payment/checkout/route.ts` (Checkout Session creation), and
`app/api/webhooks/stripe/route.ts` (webhook receiver, signature-verified,
fails closed if `STRIPE_WEBHOOK_SECRET` is unset). The generator does not
generate a `Plan`/`Product`/`Purchase`-style entity, an authz/entitlement
layer, or any payment UI — model those as ordinary schema entities and
wire them into the stub routes. Scope is one-time purchases only (Checkout
Session `mode: payment`); subscriptions are left for a consumer to add. See
[docs/knowledge/stripe-payment-integration.md](docs/knowledge/stripe-payment-integration.md).

---

## Performance

- **Streaming Suspense**: pages stream HTML to the browser immediately, reducing TTFB. Data is loaded asynchronously in Suspense boundaries.
- **Skeleton screens**: every generated list and view page renders a skeleton while data loads, preventing layout shift.
- **Parallel fetching**: data and permission checks are fetched in parallel using `Promise.all`, minimizing server round-trips.
- **Query timeout** (`lib/prisma.ts`): the direct-connection (PrismaPg) path applies a default 30-second `statement_timeout`, configurable via `STATEMENT_TIMEOUT_MS` (`0` disables it). This is the default path in every environment — Accelerate (`PRISMA_DATABASE_URL`) is opt-in and off by default; if enabled, `statement_timeout` is not forwarded and has no effect.
- **FK index coverage**: `scripts/add_required_indexes.py` auto-detects `@relation` FK columns and adds `@@index` for them (the generator's demo schema grew from 18 to 36 indexes).
- **pg_trgm GIN indexes for search**: `generate-code` emits `scripts/create-gin-indexes.sql`, applied manually with `psql` — kept outside `prisma/schema.prisma` to avoid a `prisma migrate dev` drift loop on `gin_trgm_ops`.
- **Search `COUNT(*)` opt-out**: `SearchOpts.count: false` skips both `COUNT(*)` queries in cross-entity search (returns `total: -1`).

See [docs/knowledge/performance-improvements.md](docs/knowledge/performance-improvements.md).

---

## Running Tests

### Unit Tests (Vitest)

```bash
npm run test
```

### Python Generator Tests (pytest)

```bash
npm run test:pytest
```

### Lint

```bash
npm run lint
```

### E2E Tests — Full Pipeline

```bash
npm run test:e2e:build   # docker:up:test runs automatically; generate-code + db:push + db:generate + db:seed-baseline + build
npm run test:e2e:cy:api  # API-only Cypress specs
npm run test:e2e         # full Cypress suite (build + start + run)
npm run docker:down:test # stop the test database when done
```

### E2E Tests — Hot-reload Mode

```bash
npm run test:e2e:dev     # docker:up:test runs automatically; dev server mode (no build required)
npm run docker:down:test # stop the test database when done
```

`NODE_ENV=test` is set automatically by all `test:e2e` scripts — no manual environment switching required.

See [docs/knowledge/testing-cypress.md](docs/knowledge/testing-cypress.md) for Cypress patterns and CI/CD configuration.

---

## Environment Setup

Next.js loads environment files automatically based on `NODE_ENV`:

| File | Environment | Notes |
|------|------------|-------|
| `.env` | All | Common baseline (committed) |
| `.env.development` | Development | PORT 3001, postgres-dev (port 5433) |
| `.env.test` | Test/E2E | PORT 3000, postgres-test (port 5432), redis-test (port 6379) |
| `.env.production` | Production | Set variables in Vercel dashboard (gitignored) |
| `.env.local` | Local secrets | Gitignored; created manually if needed |

Key variables:

| Variable | Development | Test | Production |
|----------|------------|------|-----------|
| `PORT` | 3001 | 3000 | Vercel-assigned |
| `DATABASE_URL` | `postgresql://…@localhost:5433/my_next_dev` | `postgresql://…@localhost:5432/my_next_test` | Vercel env var |
| `REDIS_URL` | not set (in-memory fallback) | `redis://localhost:6379` | managed |
| `AUTH_SECRET` | set in `.env.development` | set in `.env.test` | set in Vercel |
| `NEXTAUTH_URL` | `http://localhost:3001` | `http://localhost:3000` | production URL |

No manual environment switching or symlinks are required.

### Changing the Port

If port 3001 (dev) or 3000 (test) conflicts with another application, update `PORT` in the relevant env file — no edits to `docker-compose.*.yml` are needed:

- Development: set `PORT=<new-port>` in `.env.development`
- Test: set `PORT=<new-port>` in `.env.test`

### Local Production Build

Running `build:full` locally requires `.env.production` and `.env.production.local` (both are gitignored). A simpler alternative for local production testing is to use `.env.test` + `docker-compose.test.yml`, which reuses the existing test containers.

---

## Deployment

**Vercel** is the default deployment target — no configuration needed.

**Search-engine indexing is blocked by default.** Generated apps are
primarily internal tools, and a Vercel *production* deployment gets no
automatic crawler protection (unlike a preview deployment). `lib/site-config.ts`'s
`seo.noindex` defaults to `true`; set it to `false` to allow indexing. See
[docs/knowledge/noindex-default-and-branding-env-vars.md](docs/knowledge/noindex-default-and-branding-env-vars.md).

**GCP Cloud Run** is opt-in via the `x-cloud` annotation in `code_generator/json_schema.yaml` (commented out by default). It only activates when both `enabled: true` and `provider: gcp` are set explicitly; without it, generated output is unaffected.

When enabled, `generate-code` additionally emits:
- A multi-stage, non-root `Dockerfile` with a `HEALTHCHECK`, plus `.dockerignore`
- `next.config.ts` with `output: 'standalone'`
- A GCS Signed URL upload route (overrides the default Vercel Blob upload route) and a V4 Signed URL proxy route (`app/api/gcs/[...path]/route.ts`)
- `proxy.ts` header rewriting so Cloud Run's internal `:8080` port never leaks into a redirect `Location` header

Idempotent automation scripts in `scripts/` drive the GCP side, run in this
order — `x-cloud` enable → `generate-code` → `gcp-setup.sh` → `gcp-deploy.sh` →
`gcp-seed.sh` (optional):

| Script | Purpose |
|---|---|
| `gcp-env.sh` | Source environment variables; generate-once-persist secrets |
| `gcp-setup.sh` | Idempotently provision GCP infrastructure (Cloud SQL, service account, Upstash, Secret Manager, GCS) |
| `gcp-deploy.sh` | Build the image, run migrations, deploy to Cloud Run |
| `gcp-seed.sh` | Seed the database |
| `gcp-teardown.sh` | Tear down GCP resources (two-step confirmation) |

`gcp-deploy.sh` needs the `Dockerfile` that `generate-code` emits — run
`generate-code` after enabling `x-cloud`, before `gcp-deploy.sh`.
`gcp-setup.sh` has no such dependency and may run before or after
`generate-code`. See
[docs/knowledge/gcp-automation-design.md](docs/knowledge/gcp-automation-design.md)
for the full runbook, including why the order matters and how each step was
verified.

GCP connects to the database directly (`DATABASE_URL`, `PrismaPg`, no pooler, `STATEMENT_TIMEOUT_MS` applied). Accelerate (`PRISMA_DATABASE_URL`) is off by default in every environment, including production — see `docs/knowledge/architecture-overview.md`'s "Environment configuration" section and the comment in `lib/prisma.ts`.

---

## Project Structure

```
app-generator/
├── app/                      Next.js App Router
│   ├── [locale]/             All user-facing pages (locale-prefixed URLs)
│   │   ├── {entity}/         Generated CRUD pages per entity
│   │   ├── docs/             Auto-generated entity documentation (MDX)
│   │   ├── login/            Auth pages (hand-written)
│   │   ├── register/
│   │   └── setting/          User settings: MFA, account linking (hand-written)
│   ├── api/
│   │   ├── {entity}/         Generated REST endpoints (when api: true)
│   │   └── auth/             Auth.js v5 route handlers (hand-written)
│   └── generated/            Placeholder directory
├── code_generator/           Python code generation pipeline
│   ├── json_schema.yaml      Single source of truth: entity definitions
│   ├── generate.py           Main orchestrator
│   ├── generators*.py        Context builders per output type
│   ├── templates/            Jinja2 templates (*.jinja2)
│   └── tests/                Pytest unit tests for the generators
├── components/               React components
│   ├── _standard/            Shared UI (ListWrapper, FormSkeleton — hand-written)
│   └── {entity}/             Generated per-entity components
├── lib/                      Business logic and utilities
│   ├── {entity}/             Generated per-entity service/actions/types/getters
│   ├── auth/                 Auth helpers (hand-written)
│   ├── mfa/                  TOTP/MFA logic (hand-written)
│   ├── account-link/         OAuth account linking (hand-written)
│   ├── authz.ts              Authorization enforcement (hand-written)
│   └── prisma.ts             Prisma client singleton
├── prisma/                   Database schema and migrations
│   ├── schema.prisma         Authoritative DB schema (hand-written)
│   └── migrations/           Prisma migration history
├── scripts/                  Utility scripts
│   ├── seed-baseline.ts      Baseline data seeding
│   └── run-next-dev.js       Dev server launcher
├── cypress/                  E2E tests
│   ├── e2e/                  Generated per-entity specs + hand-written flow tests
│   └── support/              Generated per-entity helpers + fixtures
├── docs/
│   ├── generated/            Auto-generated entity reference docs
│   └── knowledge/            Hand-written architectural knowledge docs
├── messages/                 i18n translation files (en, ja)
├── auth.ts                   Auth.js v5 configuration (hand-written)
├── proxy.ts                  Next.js middleware (hand-written)
└── docker-compose.*.yml      Per-environment DB + Redis containers
```

---

## Documentation

All architectural documentation lives in `docs/knowledge/`:

| File | Contents |
|------|---------|
| [architecture-overview.md](docs/knowledge/architecture-overview.md) | Code generation pipeline, project structure, generated vs. hand-written boundary, tech stack, environment configuration |
| [schema-yaml-configuration.md](docs/knowledge/schema-yaml-configuration.md) | Full reference for `code_generator/json_schema.yaml` |
| [prisma-schema-conventions.md](docs/knowledge/prisma-schema-conventions.md) | Prisma model naming, index, and relation conventions |
| [code-generation-custom-extensions.md](docs/knowledge/code-generation-custom-extensions.md) | Extension points: where to add custom code without overwriting generated files |
| [testing-cypress.md](docs/knowledge/testing-cypress.md) | Generated Cypress patterns, MUI interaction helpers, CI/CD configuration |
| [multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md) | Tenant isolation, RBAC, creator/assignee access control |
| [authentication.md](docs/knowledge/authentication.md) | Auth.js v5 setup, Google SSO, MFA/TOTP, account linking |
| [performance-improvements.md](docs/knowledge/performance-improvements.md) | Streaming Suspense, skeleton screens, parallel fetching |
| [troubleshooting.md](docs/knowledge/troubleshooting.md) | Common build, test, code generation, and database failure patterns with step-by-step fixes |
| [i18n-locale-routing.md](docs/knowledge/i18n-locale-routing.md) | next-intl v4 setup, locale routing, translation file conventions |
| [dark-mode-and-hydration.md](docs/knowledge/dark-mode-and-hydration.md) | System-aware dark mode, SSR-safe theme initialization |
| [timezone-handling.md](docs/knowledge/timezone-handling.md) | Server/client timezone conventions |
| [child-datagrid-reference-columns.md](docs/knowledge/child-datagrid-reference-columns.md) | Inline DataGrid children, reference column rendering |
| [mobile-responsive-layout.md](docs/knowledge/mobile-responsive-layout.md) | Responsive layout conventions, search header icon, mobile account section |
| [search.md](docs/knowledge/search.md) | Cross-entity full-text search: schema opt-in, pg_bigm, authorization, generated API and UI |
| [appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) | Approval flow system detail, post-approval event dispatch (`on_approved`) |
| [appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) | Comment bridge system detail |
| [appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md) | Inventory reservation (`x-reservation`), split (`x-splittable`), and receiving (`x-ledger-source`) generic primitives — current behavior |
| [cleanup.md](docs/knowledge/cleanup.md) | Removing generated files: default cleanup, manifest vs schema-driven, `--prune-orphans`, orphan handling |
| [gcp-automation-design.md](docs/knowledge/gcp-automation-design.md) | GCP Cloud Run deployment: `x-cloud` opt-in, Dockerfile, GCS uploads, environment automation scripts |
| [claude-code-settings-consumer-side.md](docs/knowledge/claude-code-settings-consumer-side.md) | `.claude/settings.json` discovery rules, OS-independent permission syntax, the compound-command matching trap, and how to verify a settings file actually loaded — read this before editing `.claude/settings.json` here or in `app-template` |
| [legal-documents.md](docs/knowledge/legal-documents.md) | Terms of Service / Privacy Policy pages: why document locale is decoupled from the site UI locale, Markdown-over-JSON/MDX rationale, and how to add a document language |

---

## Current Status & Roadmap

### Implemented

| Feature | Status |
|---------|--------|
| Schema-driven CRUD generation | ✅ Implemented |
| REST API with API key auth | ✅ Implemented |
| Gantt chart views | ✅ Implemented |
| Generated Cypress tests | ✅ Implemented |
| Email/password authentication | ✅ Implemented |
| Google SSO (Auth.js v5) | ✅ Implemented |
| Account linking | ✅ Implemented |
| Role-based access control | ✅ Implemented |
| Comment threads | ✅ Implemented |
| Attachment management | ✅ Implemented |
| Internationalization (en/ja) | ✅ Implemented |
| Dark mode | ✅ Implemented |
| Rate limiting | ✅ Implemented |
| Streaming Suspense / Skeleton screens | ✅ Implemented |
| Dashboard charts (x-display.dashboard) | ✅ Implemented |
| Inventory reservation (x-reservation) | ✅ Implemented |
| Inventory ledger (x-ledger-source) | ✅ Implemented |
| Receiving workflow | ✅ Implemented |
| Split action (x-splittable) | ✅ Implemented |
| Approval-lines helpers (x-approval-lines) | ✅ Implemented |
| Terminal rejection (x-readonly-fields) / rejection event dispatch (on_rejected_dispatch) | ✅ Implemented |
| Integer enums | ✅ Implemented |
| nativeEnum type safety (6 promoted fields) | ✅ Implemented |
| FK scalar auto-inference | ✅ Implemented |
| FK autocomplete custom filter hook | ✅ Implemented |
| Organization isolation enforcement (cross-org mutation deny) | ✅ Implemented |
| Wrapper component architecture | ✅ Implemented |
| MUI-free generated code (wrapper round 2) | ✅ Implemented |
| Comment reactions | ✅ Implemented |
| Generalized bridge pattern | ✅ Implemented |
| Cross-entity full-text search (x-generate.search) | ✅ Implemented |
| Approval event dispatch (on_approved) | ✅ Implemented |
| Mobile header / sidebar account section | ✅ Implemented |
| Schema-driven textarea rows (x-ui.rows) | ✅ Implemented |
| GCP Cloud Run deployment (x-cloud) | ✅ Implemented |
| Audit log viewer | ✅ Implemented |
| GDPR / data protection (x-pii, anonymizeUser, x-gdpr-mode) | ✅ Implemented |
| Attachment display opt-out (showImages/showFiles) | ✅ Implemented |
| Performance hardening (statement_timeout, FK indexes, GIN indexes, COUNT opt-out) | ✅ Implemented |
| Declarative write-locked values (x-write-locked-values) | ✅ Implemented |
| Declarative state-transition lockdown (x-state-lockdown) | ✅ Implemented |

> **Backward compatibility (v1.4 → v1.5)**: Non-breaking. Existing schemas work unchanged. Cross-entity search is opt-in per entity (`x-generate.search: true`). Approval event dispatch activates only when `x-approval.on_approved` is set in the schema.

> **Backward compatibility (v2.0 → v3.0)**: **Breaking** in eight areas — default `statement_timeout` (30s, direct-connection path), `pageSize > 200` now returns `400` instead of truncating, organization-scoped mutation paths now deny cross-org access by ID, the new `user.anonymized_at` column, the new `audit_log.actor_user` foreign key, the `nativeEnum` promotion of 6 previously-`Int` fields, the new `notification` table, and `nativeEnum` member names normalized to lowercase snake_case — the last five require `prisma db push`/`migrate deploy` and/or a data migration on pre-3.0 databases (the `nativeEnum` fields need an explicit `ALTER TABLE ... USING` first to avoid data loss; the FK can also require cleaning up orphaned rows first; the member-name normalization requires the migration SQL in [docs/knowledge/enum-member-naming.md](docs/knowledge/enum-member-naming.md)). GCP deployment and attachment display opt-out are non-breaking. See [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

### In Progress

See the [Roadmap](#roadmap) section for features with partial implementations.

### Planned

- Performance improvements for large datasets (100k+ rows)
- Hosted no-code schema editor

---

## License

This project is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

### What you can do
- ✅ Use the generator to build and commercialize web applications
- ✅ Modify the application framework, generated code, and configuration
  files freely — these modifications do not need to be shared publicly
- ✅ Distribute your customized application (framework + generated code)
  without sharing modifications publicly
- ✅ Modify the generator for internal use

### Sharing modifications
The public sharing requirement applies only to modifications of
**generator source code** — source files (`.py`, `.jinja2`, and similar
programming language files) within the `code_generator/` directory.

Schema definitions (`.yaml`, `.json`) and all files outside
`code_generator/` — including generated code, framework code,
components, and configuration — may be kept private.

> **Example**: If you improve the Python code generator, share those
> improvements. If you customize your authentication flow, form
> components, or API routes, those are yours to keep private.

### What you cannot do
- ❌ Use the generator to operate a competing commercial code generation
  service (Competing Use)

### Becoming MIT

On the fourth anniversary of the first public release of this version, the license automatically converts to the **MIT License**.

### Commercial license

If you need to use this software in a way not permitted by BUSL-1.1, contact [contact@rhymion.com](mailto:contact@rhymion.com).

See [LICENSE](./LICENSE) for the full license text.

---

## Contributing

Contributions are welcome. By submitting a pull request, you agree that your contribution will be licensed under the same terms as this project.

Please open an issue before beginning significant work to discuss the approach.

---

## About

This application is developed by [Rhymion Labs](https://rhymion.com), founded in 2026.

Our focus is helping organizations build the internal tooling they need without diverting engineering resources from their core business.

- Website: [rhymion.com](https://rhymion.com)
- GitHub: [github.com/rhymion](https://github.com/rhymion)
- LinkedIn: [linkedin.com/company/rhymion](https://linkedin.com/company/rhymion)
- Contact: [contact@rhymion.com](mailto:contact@rhymion.com)
