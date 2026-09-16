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
4. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build
5. `npm run test:e2e:cy:api` — API Cypress specs only
6. `npm audit --omit=dev --audit-level=high`
7. `npm run check:readme-sync` — fails closed if this branch's diff touches
   README.md without also touching README_ja.md (or vice versa)

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

Step 7 only proves both README files were touched, not that their content
actually agrees — if this task's diff includes a README.md change, bring
README_ja.md's content up to date with it (and vice versa) before this
step, not after. See `docs/knowledge/readme-en-ja-sync-gate.md`.

## Write-once side-effect hooks (`service_after_create.ts` / `_update.ts` /
`_delete.ts` / `_approve.ts` / etc.)

Two automated checks already exist for these hooks and should not be
second-guessed by hand: `validate.py`'s write-once stub asymmetry check
(rejects an implemented `service_after_create.ts` with a still-untouched
`service_after_update.ts`/`_delete.ts` counterpart) and the write-once
side-effect round-trip test pattern (`docs/knowledge/write-once-side-
effect-roundtrip-test.md` — proves a hook's forward and revert edits are
both actually reversible). Both are file-level or behavior-level machine
checks. What they cannot see is judgment — the items below are exactly the
gap between what those checks cover and what a human has to decide.

1. **Did you provide a way back?** The asymmetry check only sees "a hook
   file exists or it doesn't" — it cannot tell whether the update/delete
   hook you wrote actually *undoes* what the create hook did, only that
   something is there. If you implement a hook that has a side effect,
   write the round-trip test from `docs/knowledge/write-once-side-effect-
   roundtrip-test.md` for it — this is not optional once the hook exists.
   If the round-trip test for your hook has to be hand-written rather than
   generated (most cases today — see that doc's "Why there is no generated
   per-entity spec" section), write it anyway and record the reason inline
   next to the test.

2. **Protecting a reference outside an approval flow.** Whether editing or
   deleting some row would break a side effect that already fired on a
   *different* row referencing it is, outside an approval flow, something
   only reading the actual hook code can answer — there is no schema
   signal an automated check could key off. There is no generic tooling
   for this case. If you are implementing or reviewing a hook whose effect
   depends on data reachable through a foreign key, trace every entity
   that references it by hand and decide case by case.

3. **Protecting a reference inside an approval flow.** When an approval-
   time side effect (`service_after_approve.ts`) reads a value from
   *another* entity (entity B approved, B has an FK to A, the hook reads a
   field on A), do not lock A's entire row once an approved B exists that
   references it — reference/master data (item, organization, bin,
   location, supplier, and the like) is read by many other transactions
   independently of B, and a blanket lock on the whole row breaks all of
   them. Instead, add a hand-written check to *A's own*
   `service_validation_custom.ts` that rejects a change only to the
   specific field(s) the approved hook actually reads, only while an
   approved B still references A. This is the same pattern already used
   for FK-crossing rules elsewhere in this generator family (see whichever
   consumer schema already declares one, as a working reference) — it is
   not a new mechanism, just applying the existing one here. Do not
   introduce a new `x-*` declaration key for this; express it as ordinary
   hand-written validation code.

4. **A Proxy View that reopens editing after approval.** If a Proxy View
   exposes a field for editing once its backing row is already approved,
   check first whether that field is one a `service_after_approve.ts` hook
   reads or writes. If it is, do not let the Proxy View write it directly
   — route the change through a change-request entity plus its own
   approval, the same way any other post-approval change to an audited
   record should be handled, rather than a bare edit that silently
   bypasses whatever the approval hook already did.

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
