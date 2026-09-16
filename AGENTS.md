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
- `docs/knowledge/virtual-resolver-guide.md` - virtual display columns spec
- Other `docs/knowledge/*.md` - topical references (i18n, dark mode, datagrid, timezone, etc.)

## Docker Compose Setup

Two separate Compose files manage local containers:

| File | Purpose | Containers |
|------|---------|------------|
| `docker-compose.dev.yml` | Development database | `postgres-dev` (port 5433, DB `my_next_dev`) |
| `docker-compose.test.yml` | Test containers | `postgres-test` (port 5432) + `redis-test` (port 6379) |

```bash
# Development
npm run docker:up:dev    # start postgres-dev
npm run docker:down:dev  # stop postgres-dev

# Testing
npm run docker:up:test   # start postgres-test + redis-test
npm run docker:down:test # stop test containers
```

Dev environment sets no `REDIS_URL` in `.env.development`, so `getRateLimiter()` falls back to the in-memory rate limiter automatically. Redis is only required for E2E tests and Redis adapter unit tests.

## Task classification

Every request is one of five types. Identify the type before touching anything;
if unclear, ask. Each type has its own completion gate.

### generate-schema

Edits restricted to `prisma/schema.prisma`, `code_generator/json_schema.yaml`,
and `docs/knowledge/*.md`. Python generators and existing (non-generated) TypeScript
are **unchanged**.

Use `/generate-schema` slash command. In Codex, use `.codex/prompts/generate-schema.md`.

Gate:

1. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build
2. `npm run check:generated` — validates generator-emitted output (run after generate-code inside step 1)
3. `npm run test:e2e:cy:api` — API Cypress specs only
4. `npm run lint`
5. `npm audit --omit=dev --audit-level=high`

(`npm run test:pytest` and `npm run test` are skipped — Python generators and component code unchanged.)

### update-generator

Adds or modifies Python generators (`code_generator/*.py`) or templates
(`code_generator/templates/`). May include a schema update. Document new behavior
under `docs/knowledge/`.

Use `/update-generator` slash command. In Codex, use `.codex/prompts/update-generator.md`.

Gate:

1. `npm run test:pytest`
2. `npm run test:e2e:build`
3. `npm run check:generated`
4. `npm run test:e2e:cy:api`
5. `npm run test:e2e:cy:ui`
6. `npm run test:vitest`
7. `npm run lint`
8. `npm audit --omit=dev --audit-level=high`
9. `pip-audit -r requirements.txt`

### add-component

Adds or updates a UI component (non-generated TypeScript/React). Always create or
update the corresponding component test.

Use `/add-component` slash command. In Codex, use `.codex/prompts/add-component.md`.

Gate:

1. `npm run test:e2e:build`
2. `npm run test` — component tests
3. `npm run test:e2e:cy:api`
4. `npm run lint`
5. `npm audit --omit=dev --audit-level=high`

### update-code

Updates non-generated TypeScript, configuration, or framework integrations (other
than UI components). May include build config, middleware, auth, etc.

Use `/update-code` slash command. In Codex, use `.codex/prompts/update-code.md`.

Gate:

1. `npm run test:e2e:build`
2. `npm run test:e2e:cy:api`
3. `npm run lint`
4. `npm audit --omit=dev --audit-level=high`

### investigate

Reading code, answering "how does X work?", or proposing solutions. **No** edits
to source files, no commands run.

Use `/investigate` slash command. In Codex, use `.codex/prompts/investigate.md`.

Gate: none. Cite findings with `file:line` references.

## Gate matrix

> **Note**: The canonical gate list for each task type is defined in
> `.claude/commands/<type>.md §Completion gate`. This table is a
> human-readable summary and may lag behind the commands files. When
> in doubt, read the commands file.

| Task type        | pytest | build | check:generated | component test | e2e API | e2e UI | vitest | eslint | npm audit | pip-audit |
|------------------|:------:|:-----:|:---------------:|:--------------:|:-------:|:------:|:------:|:------:|:---------:|:---------:|
| generate-schema  | -      | ✓     | ✓               | -              | ✓       | -      | -      | ✓      | ✓         | -         |
| update-generator | ✓      | ✓     | ✓               | -              | ✓       | ✓      | ✓†     | ✓      | ✓         | ✓         |
| add-component    | -      | ✓     | -               | ✓              | ✓       | -      | -      | ✓      | ✓         | -         |
| update-code      | -      | ✓     | -               | -              | ✓       | -      | -      | ✓      | ✓         | -         |
| investigate      | -      | -     | -               | -              | -       | -      | -      | -      | -         | -         |

† conditional — `npm run test` is skipped when component code is unchanged
(see `.claude/commands/update-generator.md §Completion gate`).

Gate commands:
- **pytest**: `npm run test:pytest`
- **build**: `npm run test:e2e:build` (docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build)
- **check:generated**: `npm run check:generated` (run after generate-code; see below)
- **component test**: `npm run test`
- **e2e API**: `npm run test:e2e:cy:api`
- **e2e UI**: `npm run test:e2e:cy:ui` (non-API Cypress specs: desktop + mobile)
- **vitest**: `npm run test:vitest` (component/unit tests, non-watch)
- **eslint**: `npm run lint`
- **npm audit**: `npm audit --omit=dev --audit-level=high`
- **pip-audit**: `pip-audit -r requirements.txt`

Run in the order listed above.

See also: [§ Generated-code prerequisites for gates](#generated-code-prerequisites-for-gates) for rules on isolated gate runs.

## Generated-code prerequisites for gates

### Why this matters

Handwritten files in `components/_standard/`, `lib/`, and other locations
import from generated entity code (e.g. `lib/organization/types.ts`,
`lib/attachment/actions.ts`). When generated files are absent, TypeScript
and other tools emit **false-positive errors** that are not real bugs.

### Rule

1. **Standard gate sequence satisfies this automatically.**
   The `build` gate (`npm run test:e2e:build`) already runs `generate-code`
   internally as its first step. If you run gates in the standard order,
   generated code will be present for all subsequent steps.

2. **Isolated runs require explicit prefixing — except `npm run lint`.**
   When running `npx tsc --noEmit` (or any other type-checking tool) without
   going through `test:e2e:build` first, run `npm run generate-code`
   manually before the gate command. Otherwise generated imports will be
   missing and false-positive TS errors will appear.

   **`npm run lint` (`eslint`) is the one exception — do not prefix it with
   `generate-code`.** `eslint.config.mjs` has no `parserOptions.project`
   (no type-aware linting), so a missing generated import never produces a
   false-positive here the way it does for `tsc` — proven empirically by
   CI's `Lint` job, which runs `npm ci && npm run lint` with no
   `generate-code` step and has always passed. Worse, running `generate-code`
   before `npm run lint` actively breaks this gate: it makes ESLint additionally
   lint ~230 freshly generated files (Cypress specs, support helpers) that
   CI's `Lint` job never sees, against a `--max-warnings` ceiling calibrated
   for CI's condition — this exact mistake produced a false "15→93 warning
   regression" investigation (cmd_600) when there was no regression at all.
   `npm run lint` must always run on a checkout where `generate-code` has
   not yet run (see `docs/knowledge/lint-gate-must-match-ci-precondition.md`).

3. **Restore the working tree after PASS.**
   After gates pass, return the working tree to its pre-generate-code state:
   - Files in `.gitignore`-covered directories remain as untracked — no action needed.
   - For directories not covered by `.gitignore`, first verify with
     `git clean -n <dir>` (dry-run), then clean only confirmed generated
     directories: `git clean -fd <dir>`.

4. **Never commit generated code.**
   Generated files produced by `npm run generate-code` must not be included
   in commits. This policy was established in cmd_036 / cmd_051 / cmd_062.
   Use `npm run check:generated` (see Gate matrix) to verify compliance.

### Distinguishing false-positives from real errors

If TypeScript reports an error:
- Run `npm run generate-code` first.
- Re-run `npx tsc --noEmit`.
- **Error disappears** → it was a false-positive caused by missing generated imports.
- **Error persists** → it is a real error that must be fixed.

See also: [§ Gate matrix](#gate-matrix) for the standard sequence.

## Triage rules

- If a request could be update-code *or* investigate, ask before editing.
- If a generate-schema change starts requiring Python or non-generated TypeScript edits,
  it has become update-generator or add-component — switch gates and announce the change.
- Slash commands `/generate-schema`, `/update-generator`, `/add-component`, `/update-code`,
  `/investigate` correspond to the five task types. In Codex, use the matching prompt files
  under `.codex/prompts/` as copyable workflow prompts.

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

| Failure               | Investigate in this order                                          |
|-----------------------|--------------------------------------------------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug  |
| Build fails           | 1. config → 2. schema → 3. code bug (VCS-managed and generated)   |
| Test fails            | 1. generated test code bug                                         |
| Other test fails      | 1. generation logic missing a case → 2. product code bug           |

## When a gate step fails

- Failure caused by your change → fix it and re-run.
- `generate-code` fails but `npm run migrate:reset:test` + `npm run db:generate` would
  succeed and the non-generated code is correct → **stop and report**: there is a
  generator/web inconsistency that needs separate attention.
- Environmental failure (network, missing OS package, hardware) → report and ask for
  direction.

## Skip = fail

A skipped test is a failed test unless the user has explicitly approved skipping it.

## Dependency auditing

`npm audit --omit=dev --audit-level=high` is part of every gate (except investigate).
`pip-audit -r requirements.txt` is required for update-generator tasks (Python generators changed).
The two halves of the policy work together:

- **Proactive**: `.github/dependabot.yml` opens weekly grouped PRs for
  minor/patch updates and immediate PRs for security advisories across
  npm, pip, and github-actions ecosystems.
- **Continuous**: the audit commands above run on every applicable gate,
  so a vulnerable dep can't sit unnoticed between Dependabot scans, and
  any non-Dependabot change still has to pass the same bar.

`--omit=dev` on `npm audit` scopes the check to production deps so
dev-only tooling (vitest, eslint, prisma generator plugins, …) doesn't
gate the build; a high-severity dev-only advisory is still triaged via
the Dependabot PR. `--audit-level=high` only fails on high/critical;
moderate is warning-only. `pip-audit` runs against `requirements.txt`
rather than the installed env so the gate is reproducible across machines.

If the gate flags a high/critical CVE you can't immediately fix, open a
PR upgrading the offending dep first; the rest of the change comes after.

## check:generated

`npm run check:generated` bans `prisma.$queryRaw` / `prisma.$executeRaw` everywhere in
generator-emitted files and bans direct `prisma.<model>.{create,update,delete,upsert,
createMany,updateMany,deleteMany}` calls outside the entity service layer
(`lib/<entity>/service.ts`, `service_validation.ts`, and `service_after_create.ts` if a
project has one left over from before that write-once hook's retirement — see
`docs/knowledge/code-generation-custom-extensions.md`).
Reads (`findUnique`, `findMany`, …) are unaffected so API routes and server actions can
still load the row they need to permission-check before delegating to the service.
Genuine exceptions go in `code_generator/check_generated_allowlist.yaml` with a recorded
reason. Run after `generate-code` so it sees the just-emitted output.

## Permanent Rules

### Don't use Prisma.raw (to prevent SQL injection)
Raw SQLs such as `Prisma.raw` / `$queryRaw` / `$executeRaw` are prohibited.
Abolished in cmd_088. Also prohibited in new code.

### Starting test server with different ports
Start server for test execution using ports that are different from existing ones. Don't kill or restart existing ones. 

### Don't overwrite / delete stub files generated once
Files such as `lib/{entity}/virtual_resolvers.ts` are generated by `generate-code` only once and not overwritten later. Don't try to delete them or make `generate-code` overwrite them. Custom logic may be included there.

### CHANGELOG: product changes vs internal changes

`README.md` documents product changes only (unchanged). `CHANGELOG.md` also
records internal/development changes, but keeps them out of the product-facing
sections: give `[Unreleased]` a separate `### Internal` subsection alongside
`### Added` / `### Changed` / `### Fixed` / `### Security`.

Sorting test (apply mechanically, don't judge "internal vs external" by feel):
does this change what the generator emits, or how a consumer builds/runs their
app? Yes → a product change (`Added`/`Changed`/`Fixed`/`Security`). No →
`Internal`. Example: a Dependabot config fix is `Internal` — no generated app
changes as a result.

`Internal` entries stay short: 1-2 lines, plus a link to the relevant
`docs/knowledge/*.md` doc when one exists (the doc is the record; the
changelog entry is a signpost to it). Product-change entries keep the existing
level of detail — they're the only ones a consumer reads when a release note
gets cut from this file.

## Sanity check

Before stopping, review the change and answer:

- Does this match the original request?
- Are there missing edge cases?
- Could this break anything else?

Report the result explicitly.
