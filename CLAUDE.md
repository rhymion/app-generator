# my-next - App Generator

Pipeline: `code_generator/json_schema.yaml` + `prisma/schema.prisma` -> Python
generators (`code_generator/*.py`) -> TypeScript modules under `app/generated/`
and Cypress tests.

## Authoritative knowledge

When editing the schema or generators, these docs are the source of truth. If
behavior conflicts with a doc, treat the doc as wrong and fix it as part of
your change.

- `docs/knowledge/prisma-schema-conventions.md` - Prisma model rules
- `docs/knowledge/schema-yaml-configuration.md` - `code_generator/json_schema.yaml` reference
- `docs/knowledge/code-generation-custom-extensions.md` - `x-generate` extensions
- `docs/knowledge/testing-cypress.md` - generated Cypress patterns
- `docs/knowledge/architecture-overview.md` - project structure, code generation pipeline
- `docs/knowledge/multi-tenancy-and-permissions.md` - tenant isolation, auth/authz system
- `docs/knowledge/troubleshooting.md` - common errors and fixes
- `docs/knowledge/appendix/approval-flow.md` - Approval Flow System detail
- `docs/knowledge/appendix/comment-bridge.md` - Comment Bridge System detail
- `docs/knowledge/virtual-resolver-guide.md` - virtual display columns の仕様
- `docs/knowledge/mobile-poc-test-runbook.md` - mandatory real-browser verification gate for `mobile/` (Expo) PoC tasks
- Other `docs/knowledge/*.md` - topical references (i18n, dark mode, datagrid, timezone, etc.)

## Docker Compose Setup

One Compose file provides the local Postgres container that both dev and
test use. `docker-compose.dev.yml` is deprecated (cmd_368/cmd_370) — dev no
longer provisions its own `my_next_dev` DB, it reuses `postgres-test` /
`my_next_test`. This project provisions its schema via `prisma db push`
during the PoC phase (no `prisma/migrations/` yet), so there is no
migration-file workflow for a separately-migrated dev DB to serve. See
`docs/knowledge/DATABASE_TESTING.md` for the full reasoning.

| File | Purpose | Containers |
|------|---------|------------|
| `docker-compose.test.yml` | Postgres + Redis, used by both dev and test | `postgres-test` (port 5432) + `redis-test` (port 6379) |
| `docker-compose.dev.yml` | Deprecated, unused by any npm script | — |

```bash
# Development (aliases to the same container as Testing, below)
npm run docker:up:dev    # start postgres-test (shared with test)
npm run docker:down:dev  # no-op — see the script for why

# Testing
npm run docker:up:test   # start postgres-test + redis-test
npm run docker:down:test # stop test containers — only when nothing else needs them
```

Dev environment sets no `REDIS_URL` in `.env.development`, so `getRateLimiter()` falls back to the in-memory rate limiter automatically. Redis is only required for E2E tests and Redis adapter unit tests.

## Task classification

Every request is one of five types. Identify the type before touching anything;
if unclear, ask. Each type has its own completion gate.

### generate-schema

Edits restricted to `prisma/schema.prisma`, `code_generator/json_schema.yaml`,
and `docs/knowledge/*.md`. Python generators and existing (non-generated) TypeScript
are **unchanged**.

Use `/generate-schema` slash command.

### update-generator

Adds or modifies Python generators (`code_generator/*.py`) or templates
(`code_generator/templates/`). May include a schema update. Document new behavior
under `docs/knowledge/`.

Use `/update-generator` slash command.

### add-component

Adds or updates a UI component (non-generated TypeScript/React). Always create or
update the corresponding component test.

Use `/add-component` slash command.

### update-code

Updates non-generated TypeScript, configuration, or framework integrations (other
than UI components). May include build config, middleware, auth, etc.

Use `/update-code` slash command.

### investigate

Reading code, answering "how does X work?", or proposing solutions. **No** edits
to source files, no commands run.

Use `/investigate` slash command.

## Gate matrix

| Task type        | pytest | build | component test | e2e API | eslint |
|------------------|:------:|:-----:|:--------------:|:-------:|:------:|
| generate-schema  | -      | ✓     | -              | ✓       | ✓      |
| update-generator | ✓      | ✓     | -              | ✓       | ✓      |
| add-component    | -      | ✓     | ✓              | ✓       | ✓      |
| update-code      | -      | ✓     | -              | ✓       | ✓      |
| investigate      | -      | -     | -              | -       | -      |

Gate commands:
- **pytest**: `npm run test:pytest`
- **build**: `npm run test:e2e:build` (docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build)
- **component test**: `npm run test`
- **e2e API**: `npm run test:e2e:cy:api`
- **eslint**: `npm run lint`

Run in the order listed above (pytest → build → component test → e2e API → eslint).

## Common rules

1. `npm run lint` must pass.
2. If a gate step fails: investigate root cause → fix → re-run until it passes.
3. Always maintain compatibility between Prisma schema and JSON schema.
4. Follow model and field naming conventions (e.g., no models ending with `_detail`).
   See `docs/knowledge/prisma-schema-conventions.md`.
5. Follow the docs (`docs/knowledge/` is the source of truth).
6. If you discover a new rule or useful skill, update the rule/skill documentation.
7. Read the docs before acting: at minimum CLAUDE.md, and relevant `docs/knowledge/` files.

## Debug priority

| Failure              | Investigate in this order                                          |
|----------------------|--------------------------------------------------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails          | 1. config → 2. schema → 3. code bug (VCS-managed and generated)  |
| Test fails           | 1. generated test code bug                                         |
| Other test fails     | 1. generation logic missing a case → 2. product code bug           |

## When a gate step fails

- Failure caused by your change → fix it and re-run.
- `generate-code` fails but `npm run migrate:reset:test` + `npm run db:generate` would
  succeed and the non-generated code is correct → **stop and report**: there is a
  generator/web inconsistency that needs separate attention.
- Environmental failure (network, missing OS package, hardware) → report and ask for
  direction.

## Skip = fail

A skipped test is a failed test unless the user has explicitly approved
skipping it.

## Permanent Rules

### Don't use Prisma.raw (to prevent SQL injection)
Raw SQLs such as `Prisma.raw` / `$queryRaw` / `$executeRaw` are prohibited.
Abolished in cmd_088. Also prohibited in new code.

### Starting test server with different ports
Start server for test execution using ports that are different from existing ones. Don't kill or restart existing ones. 

### Don't overwrite / delete stub files generated once
Files such as `lib/{entity}/virtual_resolvers.ts` are generated by `generate-code` only once and not overwritten later. Don't try to delete them or make `generate-code` overwrite them. Custom logic may be included there.

## Sanity check

Before stopping, review the change and answer:

- Does this match the original request?
- Are there missing edge cases?
- Could this break anything else?

Report the result explicitly.
