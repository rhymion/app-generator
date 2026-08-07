---
description: Update non-generated TypeScript or configuration — build + e2e API gate + eslint.
argument-hint: <change description>
---

This is an **update-code** task. Read CLAUDE.md before starting.

Minimum docs to read before starting:
- CLAUDE.md
- Relevant `docs/knowledge/` files for the area being changed

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

1. `npm run lint`            — **must run before any of the generate-code steps below** (see note)
2. `npm run test:pytest`      — Python unit tests for code generator
3. `npm run test:vitest`     — vitest unit/component tests
4. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build
5. `npm run test:e2e:cy:api` — API Cypress specs only
6. `npm audit --omit=dev --audit-level=high`

**Step 1 (`npm run lint`) must run on a checkout where `generate-code` has
not yet run** — that is what CI's `Lint` job actually checks (`npm ci && npm
run lint`, no `generate-code` step, see `.github/workflows/ci.yml`). On a
worktree where `generate-code` already ran in an earlier session, run `npm
run cleanup` immediately before this step to remove the generated output
first (do **not** use `git clean` — forbidden by CLAUDE.md D004). Linting
after generate-code checks a much larger, differently-calibrated file set
than CI ever sees and has caused false gate failures unrelated to the
current change — see cmd_600 /
`docs/knowledge/lint-gate-must-match-ci-precondition.md`.

Steps 2 and 3 run unconditionally, with no "unless affected" exemption: CI's
`unit-tests` and `pytest` jobs run on every push/PR to `main`/`master` with
no path filter, so a local gate that conditionally skips either can go green
while CI goes red on the same commit (see
`docs/knowledge/gate-exemption-must-be-machine-checkable.md` — cmd_498).

## Debug priority

| Failure | Investigate in this order |
|---------|--------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails | 1. config → 2. schema → 3. code bug (both VCS-managed and generated) |
| Test fails | 1. generated test code bug |
| Other test fails | 1. generation logic missing a case → 2. product code bug |

> **Note**: When running typecheck (`npx tsc --noEmit`) in isolation, prefix
> with `npm run generate-code` first. See `AGENTS.md §Generated-code
> prerequisites for gates` for the full rule. `npm run lint` is the
> exception — never prefix it with `generate-code` (see Completion gate
> step 1 above).
