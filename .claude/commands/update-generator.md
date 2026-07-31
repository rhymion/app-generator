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

1. `npm run test:pytest`      — Python unit tests for code generator
2. `npm run test:vitest`     — vitest unit/component tests
3. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build
4. `npm run check:generated` — generated code matches templates/schema
5. `npm run test:e2e:cy:api` — API Cypress specs only
6. `npm run test:e2e:cy:ui`  — non-API Cypress specs (desktop + mobile)
7. `npm run lint`
8. `npm audit --omit=dev --audit-level=high`
9. `pip-audit -r requirements.txt`

Both steps 1 and 2 run unconditionally, with no "unchanged" exemption: CI's
`unit-tests` (`npm run test:vitest`) and `pytest` (Python Generator Tests)
jobs run on every push/PR to `main`/`master` with no path filter, so a local
gate that conditionally skips either can go green while CI goes red on the
same commit. This exact gap caused PR #218's Unit Tests job to fail after
cmd_493 (see `docs/knowledge/gate-exemption-must-be-machine-checkable.md`
— cmd_498, the third recurrence of "gate ≠ CI").

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
