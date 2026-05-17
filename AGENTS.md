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
- `docs/knowledge/cypress-e2e-testing.md` - generated Cypress patterns
- Other `docs/knowledge/*.md` - topical references (i18n, dark mode, datagrid, timezone, etc.)

## Task classification

Every request is one of three types. Identify the type before touching anything;
if unclear, ask. Each type has its own completion gate.

### Type A - Schema-only update

Edits restricted to `prisma/schema.prisma`, `code_generator/json_schema.yaml`,
and `docs/knowledge/*.md`. Python generators (`code_generator/*.py`) and
existing (non-generated) TypeScript are **unchanged**.

Gate:

1. `npm run docker:test:up`
2. `npm run demo:generate`
3. `npm run build`
4. `npm run cy:test:api`
5. `npm audit --omit=dev --audit-level=high`

`pytest` and `npm run test` are skipped - Python and existing TS were not
touched. The full UI Cypress suite is also skipped (Chromium UI tests do not run
reliably in Codex's environment). The API-only e2e (`cy:test:api`) is fast,
headless, and covers the generated CRUD endpoints.

### Type B - Feature implementation / update

Adds or modifies Python generators, non-generated TypeScript modules,
dependencies, or framework integrations. May include a schema update. Document
new behavior under `docs/knowledge/`.

Gate:

1. `pytest code_generator/tests`
2. `npm run docker:test:up`
3. `npm run demo:generate`
4. `npm run check:generated`
5. `npm run build`
6. `npm run test`
7. `npm run cy:test:api`
8. `npm audit --omit=dev --audit-level=high`
9. `pip-audit -r requirements.txt`

`check:generated` runs after `demo:generate` so it sees the just-emitted
output. It bans `prisma.$queryRaw` / `prisma.$executeRaw` everywhere in
generator-emitted files and bans direct `prisma.<model>.{create,update,
delete,upsert,createMany,updateMany,deleteMany}` calls outside the entity
service layer (`lib/<entity>/service.ts`, `service_validation.ts`,
`service_after_create.ts`). Reads (`findUnique`, `findMany`, …) are
unaffected so api routes and server actions can still load the row they
need to permission-check before delegating to the service. Genuine
exceptions go in `code_generator/check_generated_allowlist.yaml` with a
recorded reason.

### Type C - Investigation / question

Reading code, answering "how does X work?", "what would break if...?", or
proposing solutions. **No** edits to source files.

Gate: none. Do not run docker, generators, builds, or tests. Cite findings with
`file:line` references.

## Triage rules

- If a request could be Type B *or* Type C, ask before editing.
- If a Type A change starts requiring Python or non-generated TypeScript edits,
  it has become Type B - switch gates and announce the change.
- Claude slash commands `/schema-update`, `/feature`, `/investigate` correspond
  to Types A, B, C respectively. In Codex, use the matching prompt files under
  `.codex/prompts/` as copyable workflow prompts.

## When a gate step fails

- Failure caused by your change -> fix it.
- `demo:generate` fails but `npm run db:reset:test` + `npm run db:generate`
  would succeed and the non-generated code is correct -> **stop and report**:
  there is a generator/web inconsistency that needs separate attention.
- Environmental failure (network, missing OS package, hardware) -> report and
  ask for direction.

## Skip = fail

A skipped test is a failed test unless the user has explicitly approved
skipping it.

## Dependency auditing

`npm audit --omit=dev --audit-level=high` and `pip-audit -r requirements.txt`
are part of every gate. The two halves of the policy work together:

- **Proactive**: `.github/dependabot.yml` opens weekly grouped PRs for
  minor/patch updates and immediate PRs for security advisories across
  npm, pip, and github-actions ecosystems.
- **Continuous**: the audit commands above run on every Type A/B gate,
  so a vulnerable dep can't sit unnoticed between Dependabot scans, and
  any non-Dependabot change still has to pass the same bar.

`--omit=dev` on `npm audit` scopes the check to production deps so
dev-only tooling (vitest, eslint, prisma generator plugins, …) doesn't
gate the build; a high-severity dev-only advisory is still triaged via
the Dependabot PR. `--audit-level=high` only fails on high/critical;
moderate is warning-only. `pip-audit` runs against `requirements.txt`
rather than the installed env so the gate is reproducible across
machines.

If the gate flags a high/critical CVE you can't immediately fix, open a
PR upgrading the offending dep first; the rest of the change comes after.

## Sanity check

Before stopping, review the change and answer:

- Does this match the original request?
- Are there missing edge cases?
- Could this break anything else?

Report the result explicitly.
