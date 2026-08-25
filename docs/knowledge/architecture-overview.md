# Architecture Overview

This document describes the architecture of the app-generator project as it exists in code,
covering the code generation pipeline, directory layout, generated vs. hand-written boundaries,
tech stack versions, and environment configuration.

---

## Code generation pipeline

The core value proposition of this repo is that most CRUD boilerplate is machine-generated.
A single YAML schema file drives a Python pipeline that emits TypeScript, React, and Cypress files.

```
code_generator/json_schema.yaml
        │
        ▼  python code_generator/generate.py <schema.yaml> .
        │
        ├── code_generator/generate_types.py   — entity extraction
        ├── code_generator/build_context.py    — base context builder
        ├── code_generator/context.py          — EntityContext dataclass
        ├── code_generator/generators.py       — page/service/column_def/chart contexts
        ├── code_generator/generators_i18n.py  — i18n message keys + next-intl config
        ├── code_generator/generators_test.py  — Cypress helper/spec/api-spec contexts
        ├── code_generator/generators_doc.py   — docs entity/index pages
        ├── code_generator/validate.py         — schema + Prisma index validation
        └── code_generator/templates/*.jinja2  — Jinja2 templates (one per output file type)
```

### What gets emitted per entity

For each entity defined in `json_schema.yaml`, `generate.py` writes (or skips) the following files.
The `x-generate` block in the entity definition controls which outputs are active.

| Output path | Template | Overwrite? |
|---|---|---|
| `lib/{entity}/types.ts` | `types.ts.jinja2` | Always |
| `lib/{entity}/getters.ts` | `getters.ts.jinja2` | Always |
| `lib/{entity}/service.ts` | `service.ts.jinja2` | Always |
| `lib/{entity}/service_validation.ts` | `service_validation.ts.jinja2` | Always |
| `lib/{entity}/actions.ts` | `actions.ts.jinja2` | Always |
| `lib/{entity}/chart-getters.ts` | `chart_getters.ts.jinja2` | If `has_chart` |
| `components/{entity}/FormUpsert.tsx` | `form_upsert.tsx.jinja2` | Always |
| `components/{entity}/form_validation.ts` | `form_validation.ts.jinja2` | Always |
| `components/{entity}/FormView.tsx` | `form_view.tsx.jinja2` | Always |
| `components/{entity}/column_def.tsx` | `column_def.tsx.jinja2` | If parent has children |
| `app/[locale]/{entity}/page.tsx` | `page_list.tsx.jinja2` | If `list: true` |
| `app/[locale]/{entity}/new/page.tsx` | `page_new.tsx.jinja2` | If `new: true` |
| `app/[locale]/{entity}/edit/[id]/page.tsx` | `page_edit.tsx.jinja2` | If `edit: true` |
| `app/[locale]/{entity}/view/[id]/page.tsx` | `page_view.tsx.jinja2` | If `view: true` |
| `app/[locale]/{entity}/chart/page.tsx` | `page_chart.tsx.jinja2` | If `has_chart` |
| `app/api/{entity}/route.ts` | `api_route.ts.jinja2` | If `api: true` |
| `app/api/{entity}/[id]/route.ts` | `api_detail_route.ts.jinja2` | If `api: true` |
| `app/api/{entity}/bulk/route.ts` | `api_bulk_route.ts.jinja2` | If `api: true` |
| `cypress/support/{entity}/helper.ts` | `test_helper.ts.jinja2` | If `test: true` |
| `cypress/e2e/{entity}.cy.ts` | `test_spec.cy.ts.jinja2` | If `test: true` |
| `docs/generated/{entity}.md` | `doc_entity.md.jinja2` | Always |
| `app/[locale]/docs/{entity}/page.mdx` | _(converted from .md)_ | Always |

Two cross-entity files are also regenerated on every run:

- `lib/dashboard/catalog.ts` — aggregates all entities for the dashboard widget catalog
- `lib/attachment/actions.ts` — polymorphic attachment bridge for entities that own `attachable`

### cleanup.py

`code_generator/cleanup.py` is the inverse: it removes generated files when an entity is deleted
from the schema or a generation flag is turned off. Run with `--prune-orphans` to also sweep
files left behind by prior schema versions.

---

## Project structure

```
app-generator/
├── app/                      Next.js App Router
│   ├── [locale]/             All user-facing pages (locale-prefixed URLs)
│   │   ├── {entity}/         Generated CRUD pages per entity
│   │   ├── docs/             Auto-generated entity documentation (MDX)
│   │   ├── login/            Hand-written auth pages
│   │   ├── register/
│   │   └── setting/          User settings (MFA, account linking)
│   ├── api/                  API routes
│   │   ├── {entity}/         Generated REST endpoints (when api: true)
│   │   └── auth/             Auth.js v5 route handlers (hand-written)
│   └── generated/            (placeholder directory)
├── code_generator/           Python code generation pipeline
│   ├── json_schema.yaml      Single source of truth: entity definitions
│   ├── generate.py           Main orchestrator
│   ├── generators*.py        Context builders per output type
│   ├── templates/            Jinja2 templates (*.jinja2)
│   └── tests/                Pytest unit tests for the generators
├── components/               React components
│   ├── _standard/            Hand-written shared UI (ListWrapper, FormSkeleton, etc.)
│   └── {entity}/             Generated per-entity components
├── lib/                      Business logic and utilities
│   ├── {entity}/             Generated per-entity service/actions/types/getters
│   ├── auth/                 Hand-written auth helpers
│   ├── mfa/                  Hand-written TOTP/MFA logic (crypto.ts, etc.)
│   ├── account-link/         Hand-written OAuth account linking
│   ├── audit-log.ts          Hand-written audit logging
│   ├── authz.ts              Hand-written authorization
│   ├── site-config.ts        App configuration (auth providers, allowed domains)
│   └── prisma.ts             Prisma client singleton
├── prisma/                   Database schema and migrations
│   ├── schema.prisma         Authoritative DB schema (hand-written)
│   └── migrations/           Prisma migration history
├── scripts/                  Utility scripts
│   ├── seed-baseline.ts      Baseline data seeding
│   ├── run-next-dev.js       Dev server launcher
│   └── migrations/           SQL migration helpers
├── cypress/                  E2E tests (generated + hand-written)
│   ├── e2e/                  Generated per-entity specs + hand-written flow tests
│   └── support/              Generated per-entity helpers + fixtures
├── docs/
│   ├── generated/            Auto-generated entity reference docs
│   └── knowledge/            Hand-written architectural knowledge docs (this file)
├── auth.ts                   Auth.js v5 configuration (hand-written)
├── proxy.ts                  Next.js middleware (hand-written)
├── prisma.config.ts          Prisma config with env loading
└── docker-compose.*.yml      Per-environment DB + Redis containers
```

---

## Generated vs. hand-written code

### Always overwritten on `generate.py` re-run

Every file listed in the "What gets emitted per entity" table above is unconditionally
overwritten (except write-once stubs). **Do not customize these files directly** — changes
will be lost on the next generation run. Put customizations in the designated extension points.

### Write-once stubs (preserved after first generation)

`generate.py` calls `_write_stub()` for these files, which skips writing if the file already exists:

- The stub template is `form_validation_stub.ts.jinja2`

### Hand-written extension points

| File | Purpose |
|---|---|
| `lib/{entity}/service_validation_stub.ts` | Custom validation logic (not overwritten once created) |
| `custom/` | Per-tenant UI overrides and app-specific extensions |
| `components/_standard/` | Shared UI components; not touched by the generator |
| `lib/auth/`, `lib/mfa/`, `lib/account-link/` | Auth subsystem; entirely hand-written |
| `auth.ts` | Auth.js v5 configuration; entirely hand-written |
| `proxy.ts` | Next.js middleware; entirely hand-written |
| `prisma/schema.prisma` | DB schema; hand-written, generator reads but never writes it |

---

## Tech stack

| Layer | Package | Version |
|---|---|---|
| Web framework | `next` | ^16.1.1 |
| UI library | `react` | ^19.2.3 |
| Language | `typescript` | ^5 |
| ORM | `@prisma/client` | ^7.8.0 |
| Component library | `@mui/material` | ^7.3.7 |
| Auth | `next-auth` (`Auth.js v5`) | ^5.0.0-beta.31 |
| Auth adapter | `@auth/prisma-adapter` | (bundled with next-auth) |
| Database | PostgreSQL | per docker-compose |
| Code generator | Python + Jinja2 | see `requirements.txt` |
| E2E tests | Cypress | see `package.json` |
| Unit tests | Vitest | see `vitest.config.ts` |

The generator pipeline is pure Python. `generate.py` is invoked as:

```bash
cd code_generator
python generate.py json_schema.yaml ..
```

---

## Environment configuration

Three environments are supported. They differ in database name, port, and whether Redis
and Prisma Accelerate are enabled.

| Variable | Development (`.env.development`) | Test (`.env.test`) | Production |
|---|---|---|---|
| `PORT` | 3001 | 3000 | Vercel-assigned |
| `POSTGRES_PORT` | 5433 | 5432 | managed |
| `POSTGRES_DB` | `my_next_dev` | `my_next_test` | managed |
| `DATABASE_URL` | `postgresql://…@localhost:5433/my_next_dev` | `postgresql://…@localhost:5432/my_next_test` | Vercel env var |
| `PRISMA_DATABASE_URL` | _(empty — direct connection)_ | _(empty — direct connection)_ | Prisma Accelerate URL |
| `NEXTAUTH_URL` | `http://localhost:3001` | `http://localhost:3000` | production URL |
| `AUTH_SECRET` | must be set per-env | 64-char hex generated | must be set in Vercel |
| `REDIS_URL` | not used | `redis://localhost:6379` | managed |
| `TEST_RESET_TOKEN` | `cypress-reset-token` | `cypress-reset-token` | **unset** (disables `/api/_test/reset-caches`) |

`prisma.config.ts` uses `@next/env`'s `loadEnvConfig` to load the correct `.env.*` file
before the Prisma client connects, so migrations and seeding use the same env resolution
as the Next.js dev server.

The `POSTGRES_PORT`/`REDIS_PORT` values above are docker-compose defaults
(`${POSTGRES_PORT:-5433}` for dev, `${POSTGRES_PORT:-5432}` / `${REDIS_PORT:-6379}`
for test) — export the env var before starting the containers to use a different
host port.

Accelerate is off by default in every environment, including production —
`PRISMA_DATABASE_URL` is unset and `lib/prisma.ts` falls back to a direct
connection. It has never successfully reached this environment's Cloud SQL
instance (TLS verification failure against `GOOGLE_MANAGED_INTERNAL_CA`); see
the comment in `lib/prisma.ts` for the current status.

Docker Compose files per environment:

- `docker-compose.dev.yml` — PostgreSQL on port 5433
- `docker-compose.test.yml` — PostgreSQL on port 5432 + Redis on port 6379
- `docker-compose.prod.yml` — production-targeted compose (external DB, no Redis)
