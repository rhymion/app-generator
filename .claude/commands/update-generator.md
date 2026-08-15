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

1. `npm run lint`             — **must run before any of the generate-code steps below** (see note)
2. `npm run test:pytest`       — Python unit tests for code generator
3. `npm run test:vitest`      — vitest unit/component tests
4. `npm run test:mention-gate` — fixture-schema generate-code → tsc check (see below)
5. `npm run test:oto-mandatory-gate` — required one-to-one selector fixture generate-code → tsc check (see below)
6. `npm run test:e2e:build`   — docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build
7. `npm run check:generated`  — generated code matches templates/schema
8. `npm run test:e2e:cy:api`  — API Cypress specs only
9. `npm run test:e2e:cy:ui`   — non-API Cypress specs (desktop + mobile)
10. `npm audit --omit=dev --audit-level=high`
11. `pip-audit -r requirements.txt`

**Step 1 (`npm run lint`) must run on a checkout where `generate-code` has
not yet run** — that is what CI's `Lint` job actually checks (`npm ci && npm
run lint`, no `generate-code` step, see `.github/workflows/ci.yml`). On a
fresh worktree this is naturally true if lint runs first. On a worktree
where `generate-code` already ran in an earlier session, run `npm run
cleanup` immediately before this step to remove the generated output first
(do **not** use `git clean` — forbidden by CLAUDE.md D004).

Running lint *after* generate-code silently lints ~700 additional generated
files (Cypress specs, helpers, etc.) that CI's Lint job never sees, and
against a totally different (much larger) warning count than the
`--max-warnings 20` ceiling was calibrated against — this is not a
theoretical risk: it is exactly what happened in cmd_554 (2026-08-04), whose
gate run reported "15 warnings ≤ N=20, PASS" while `develop`'s actual
post-generate-code warning count was already 93 at that same commit
(verified independently, 2026-08-07, cmd_600) — the "15" cmd_554 measured is
byte-for-byte the pre-generate-code count (7 `no-unused-expressions` + 5
`no-img-element` + 3 `no-unused-vars`), not the post-generate-code state
their own build step had just produced. There was never a 15→93
*regression* between commits — the ratchet was calibrated against the wrong
axis from the day it was introduced, and every subsequent local gate run
that lints post-generate-code inevitably reports a "regression" against a
number CI can never reproduce. Running lint first (matching CI's exact
condition) makes local and CI agree on the same count by construction; see
`docs/knowledge/lint-gate-must-match-ci-precondition.md`.

Steps 2, 3, 4, and 5 run unconditionally, with no "unchanged" exemption: CI's
`unit-tests` (`npm run test:vitest`), `pytest` (Python Generator Tests),
`mention-gate-fixture`, and `oto-mandatory-gate-fixture` jobs run on every
push/PR to `main`/`master` with no path filter, so a local gate that
conditionally skips any of them can go green while CI goes red on the same
commit. This exact gap caused PR #218's Unit Tests job to fail after cmd_493
(see `docs/knowledge/gate-exemption-must-be-machine-checkable.md` — cmd_498,
the third recurrence of "gate ≠ CI").

**Step 4 (`test:mention-gate`, cmd_535)**: runs a small, standalone fixture
entity (commentable + comment + `x-mention: true`) through the real
`build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks just the two generated files that carry the
`named_constants and has_commentable` branch — the branch cmd_532 found
broken (`c.creator_id` read off a comment type that only ever declares
`c.creator?.id`), and that this repo's own `test:e2e:build` (step 6) can
never catch because no entity in this repo's own `json_schema.yaml` wires a
`commentable` relation. ~4s. See `docs/knowledge/mention-system.md`
"cmd_532: creator include fix and gate-blind-spot confirmation" and
"Fixture gate: how to grow it" for what this covers, what it deliberately
does not (only this one branch — this repo's templates have on the order of
700 `{% if %}` branches total, most still uncovered by any fixture), and how
to extend it to a new dark branch.

**Step 5 (`test:oto-mandatory-gate`, cmd_704 [2-a] / subtask_705c)**: runs a
second, unrelated small fixture entity pair (`oto_gate_target`, a
`type: one-to-one` selector target with its own list/view/new/edit pages,
and `oto_gate_item`, whose FK to it is REQUIRED — non-nullable) through the
same `build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks the generated `page_new.tsx` + `getters.ts` — the branch cmd_704
found broken (`build_context.py`'s `required_relation_fields` rebuilt a
single `initial{Target}s` name in `page_new.tsx.jinja2` for both
`parent_rels_raw` and `selector_oto_rels` entries, but the latter actually
destructures as `initialAvailable{Target}s`), and that this repo's own
`test:e2e:build` (step 6) can never catch because no entity in this repo's
own `json_schema.yaml` — nor any currently known consumer schema — has a
required one-to-one selector FK. ~5s. A separate fixture from
`test:mention-gate` rather than an extension of it: unrelated branch, kept
legible per fixture. See
`code_generator/tests/fixtures/oto_mandatory/json_schema.yaml`'s header for
the extend-vs-new-fixture rationale and
`scripts/check_oto_mandatory_gate_fixture.sh` for the check itself.

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
