---
description: Update the Python code generator or templates — pytest + full build + e2e API gate + eslint.
argument-hint: <generator change description>
---

This is an **update-generator** task. Read CLAUDE.md before starting.

Minimum docs to read before starting:
- `docs/knowledge/prisma-schema-conventions.md`
- `docs/knowledge/schema-yaml-configuration.md`
- `docs/knowledge/code-generation-custom-extensions.md`
- `docs/knowledge/testing-cypress.md`
- `docs/knowledge/troubleshooting.md`

Task: $ARGUMENTS

## Common rules

1. `npm run lint` must pass.
2. If a gate step fails: investigate root cause → fix → re-run until it passes.
3. Always maintain compatibility between Prisma schema and JSON schema.
4. Follow model and field naming conventions.
   See `docs/knowledge/prisma-schema-conventions.md`.
5. Follow the docs (`docs/knowledge/` is the source of truth).
6. If you discover a new rule or useful skill, update the rule/skill documentation.
7. Read the docs before acting: at minimum CLAUDE.md, and relevant `docs/knowledge/` files.

## Completion gate

Run in this order:

1. `npm run test:pytest`       — Python unit tests for code generator
2. `npm run test:vitest`      — vitest unit/component tests
3. `npm run test:mention-gate` — fixture-schema generate-code → tsc check (see below)
4. `npm run test:e2e:build`   — docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build
5. `npm run check:generated`  — generated code matches templates/schema
6. `npm run test:e2e:cy:api`  — API Cypress specs only
7. `npm run test:e2e:cy:ui`   — non-API Cypress specs (desktop + mobile)
8. `npm run lint`
9. `npm audit --omit=dev --audit-level=high`
10. `pip-audit -r requirements.txt`

Steps 1, 2, and 3 run unconditionally, with no "unchanged" exemption: CI's
`unit-tests` (`npm run test:vitest`), `pytest` (Python Generator Tests), and
`mention-gate-fixture` jobs run on every push/PR to `main`/`master` with no
path filter, so a local gate that conditionally skips any of them can go
green while CI goes red on the same commit. This exact gap caused PR #218's
Unit Tests job to fail after cmd_493 (see
`docs/knowledge/gate-exemption-must-be-machine-checkable.md` — cmd_498, the
third recurrence of "gate ≠ CI").

**Step 3 (`test:mention-gate`, cmd_535)**: runs a small, standalone fixture
entity (commentable + comment + `x-mention: true`) through the real
`build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks just the two generated files that carry the
`named_constants and has_commentable` branch — the branch cmd_532 found
broken (`c.creator_id` read off a comment type that only ever declares
`c.creator?.id`), and that this repo's own `test:e2e:build` (step 4) can
never catch because no entity in this repo's own `json_schema.yaml` wires a
`commentable` relation. ~4s. See `docs/knowledge/mention-system.md`
"cmd_532: creator include fix and gate-blind-spot confirmation" and
"Fixture gate: how to grow it" for what this covers, what it deliberately
does not (only this one branch — this repo's templates have on the order of
700 `{% if %}` branches total, most still uncovered by any fixture), and how
to extend it to a new dark branch.

## Debug priority

| Failure | Investigate in this order |
|---------|--------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails | 1. config → 2. schema → 3. code bug (both VCS-managed and generated) |
| Test fails | 1. generated test code bug |
| Other test fails | 1. generation logic missing a case → 2. product code bug |

> **Note**: When running lint or typecheck in isolation, prefix with
> `npm run generate-code` first. See `AGENTS.md §Generated-code prerequisites
> for gates` for the full rule.
