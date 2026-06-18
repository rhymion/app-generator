# Rhymion App Generator — Schema-Driven Web Application Generator

Generate production-ready web applications from YAML schema definitions. Describe your data model and screen layout once — the generator produces a complete Next.js application with full CRUD pages, REST API, role-based access control, tenant-aware backend, and multilingual support.

Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), and [MUI](https://mui.com/).

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
- Organization-based access scoping — entities with organization_id are automatically filtered to organizations the user belongs to

### Built-in Systems

- **Comment threads** — polymorphic bridge pattern for attaching comments to any entity, with reaction buttons (toggle endpoint, batched aggregation, parent-owner read authorization)
- **Attachment management** — file and image upload via polymorphic bridge
- **Inventory reservation** — schema-level `x-reservation` for capacity and inventory management (count and item modes)
- **Dashboard charts** — per-entity chart widgets (column, bar, line, pie) generated from schema; stacking modes, time bucketing, typed filters, CSV/Excel export, and REST aggregate endpoints

### Performance

- Streaming Suspense for fast TTFB
- Skeleton screens during loading
- Parallel data and permissions fetching

### Security

- Rate limiting (Redis with in-memory fallback)
- CSRF protection
- Parameterized queries via Prisma

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
access each other's data. See `docs/multi-tenancy.md` for the full
phased plan.

### MFA / Two-Factor Authentication

**What works:** TOTP authentication logic, encrypted secret storage
(AES-256-GCM), and recovery codes (8 per enrollment, bcrypt-hashed)
are implemented in `lib/mfa/`. Self-service enrollment and disable are
available at `/setting/mfa`.

**Note:** Recovery codes can be entered in the standard MFA code field at login.
There is no separate recovery-code-only screen; the same code input accepts
both TOTP codes and recovery codes.

### Approval Flow

**What works:** Basic approval workflow with configurable flows
(`approval_flow`), status tracking (Pending/Approved/Rejected), audit
trail (`approval_history`), and role-based approve/reject permissions.

**What's missing:** Approval completion does not trigger downstream
state changes. Approving a record does not automatically update related
data or enable new operations.

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

For each entity defined in `code_generator/json_schema.yaml`, the pipeline generates CRUD pages, service/getter modules, API routes, Cypress test specs, and entity documentation. All generated files are overwritten on each run — customizations belong in the designated extension points (`lib/{entity}/service_after_create.ts`, `components/_standard/`, `custom/`).

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

`dev:full` runs: `docker:up:dev` → `generate-code` → `migrate:dev` → `db:generate` → `db:seed-tenant` → `dev`

For a production build:

```bash
npm run build:full
```

`build:full` runs: `docker:up:prod` → `generate-code` → `migrate:deploy` → `db:generate` → `db:seed-tenant` → `build`

> **Important**: Before running `build:full` for the first time, run `dev:full` at least once. `dev:full` uses `migrate:dev` to create Prisma migration files; `build:full` uses `migrate:deploy` which only applies existing ones.

Or follow the step-by-step instructions below.

### Start the Development Database

```bash
npm run docker:up:dev    # starts postgres-dev (port 5433, DB: my_next_dev)
```

### Generate Code, Push Schema, and Seed

```bash
npm run setup            # generate-code → db:push → db:generate → db:seed-tenant
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

Multi-step, role-based approval workflows with status tracking (Pending/Approved/Rejected) and a full audit trail. Basic approval and rejection with role-based permissions work; approval completion does not yet trigger downstream state changes. See the Roadmap section for details.

See [docs/knowledge/appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md).

### Comment Threads

A polymorphic bridge pattern allows comment threads to be attached to any entity without schema changes to each entity. Comments are displayed inline on view pages, and each comment supports reaction buttons (a per-comment toggle endpoint with batched aggregation and parent-owner read authorization).

See [docs/knowledge/appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md).

### Attachment Management

File and image upload via a polymorphic bridge, backed by Vercel Blob. Any entity that opts in receives a file attachment panel on its view page.

---

## Security

**Rate limiting** is handled by `getRateLimiter()` in the API middleware. In development (no `REDIS_URL`), it falls back to an in-memory limiter automatically. In test and production environments, it uses Redis.

**CSRF protection** is applied to all state-changing API routes.

**Organization-scoped filtering** is applied at the query layer: every list query applies an automatic `organization_id` filter, scoping data to the authenticated user's organization. Tenant-level isolation (cross-tenant data separation) is not yet implemented — see the Roadmap section.

**Role-based access control** is defined per-model in the schema. The `authz.ts` module enforces per-model CRUD permissions on every request.

**Default-deny**: new users start with zero permissions. An Administrator must explicitly assign roles to grant access. The `Administrator` role (seeded by `seed-tenant.ts`) grants full CRUD on all entities. See [docs/knowledge/authorization-default-deny.md](docs/knowledge/authorization-default-deny.md) for the permission model and test classification rules.

See [docs/knowledge/multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md).

---

## Performance

- **Streaming Suspense**: pages stream HTML to the browser immediately, reducing TTFB. Data is loaded asynchronously in Suspense boundaries.
- **Skeleton screens**: every generated list and view page renders a skeleton while data loads, preventing layout shift.
- **Parallel fetching**: data and permission checks are fetched in parallel using `Promise.all`, minimizing server round-trips.

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
npm run test:e2e:build   # docker:up:test runs automatically; generate-code + db:push + db:generate + db:seed-tenant + build
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
│   ├── seed.ts               DB seeding
│   ├── seed-tenant.ts        Tenant-specific seeding
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
| [mobile-responsive-layout.md](docs/knowledge/mobile-responsive-layout.md) | Responsive layout conventions |
| [appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) | Approval flow system detail |
| [appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) | Comment bridge system detail |

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
| Integer enums | ✅ Implemented |
| Wrapper component architecture | ✅ Implemented |
| MUI-free generated code (wrapper round 2) | ✅ Implemented |
| Comment reactions | ✅ Implemented |
| Generalized bridge pattern | ✅ Implemented |

> **Backward compatibility (v1.3 → v1.4)**: Non-breaking. Existing schemas work unchanged. Comment reactions and the generalized bridge are opt-in; no action required unless you want to use the new features.

### In Progress

See the [Roadmap](#roadmap) section for features with partial implementations.

### Planned

- Full-text search beyond column filtering
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
