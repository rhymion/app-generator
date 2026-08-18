# The local lint gate step must run under the same precondition as CI

**Rule**: `npm run lint` behaves completely differently depending on
whether `generate-code` has already run in the working tree — because
`eslint.config.mjs` has no ignore rule for generated output, so once
`generate-code` writes ~230 files (Cypress specs, support helpers, etc.)
they're linted like any other file. CI's `Lint` job never runs
`generate-code` (`.github/workflows/ci.yml`: `npm ci && npm run lint`,
nothing else). A local Completion gate that runs `npm run lint` *after* a
step that triggers `generate-code` (`test:e2e:build`, `check:generated`) is
therefore checking a different, much larger population of files than CI
checks, against a ceiling (`--max-warnings 20`, see
`lint-warning-ceiling-ratchet.md`) that was calibrated for CI's condition.

## What this caused (cmd_600, 2026-08-07)

cmd_554 (2026-08-04) measured `develop` tip `c10b1b1a` at "15 warnings ≤
N=20, PASS" as part of introducing the ratchet ceiling, running the full
Completion gate in the order the gate doc specified at the time
(`test:e2e:build` — which runs `generate-code` — several steps before
`npm run lint`). Later gate runs on later commits (cmd_567, PR #279;
cmd_600) measured the *same style* of gate run and got 93,
then 82-83, warnings — reported as a "15→93 regression" and escalated as
cmd_600 to find the offending commit via bisection.

Independent re-measurement (cmd_600) found no such regression:

- `c10b1b1a` (2026-08-04, the exact commit cmd_554 measured), full clean
  rebuild, `generate-code` run first, then `eslint`: **93 warnings** (57
  `no-unused-expressions`, 31 `no-unused-vars`, 5 `no-img-element`) —
  reproduced identically across three independent methodologies (a reused
  worktree, a from-scratch worktree with fresh `npm ci`, and with/without
  `prisma generate` run first — none of these variables changed the
  count).
- The *same commit*, `eslint` run **without** `generate-code` having run
  first (i.e. tracked source only — CI's actual condition): **15
  warnings**, and the per-rule breakdown is an exact match to what cmd_554
  reported (7 `no-unused-expressions`, 5 `no-img-element`, 3
  `no-unused-vars`).
- `c78bfef3` (2026-08-05): 93 warnings post-generate-code — identical to
  `c10b1b1a`. No commit between the two changed this number; `git diff
  c10b1b1a c78bfef3 -- code_generator/json_schema.yaml` is empty.
- `21bf66dd` / current `develop` tip (2026-08-07): 82-83 warnings
  post-generate-code — a *decrease* from 93, not an increase, from
  unrelated intervening work. (A separate report speculated commit
  `07402820` explained an increase to 82; that commit sits *after*
  `c78bfef3` in history where the count was already 93, so it cannot be
  the cause of a 15→93 jump — consistent with the "no such regression"
  finding here.)

**Conclusion**: cmd_554's own gate run linted the pre-generate-code state
(matching what CI would see) despite believing, per the gate doc's step
order, that `generate-code` had already run — whatever the exact
mechanical reason inside that one gate run (worktree/build-step
interaction not reconstructible after the fact), the resulting number
happens to be mathematically identical to the pre-generate-code count.
Every gate run since that correctly followed the documented step order
(lint *after* `test:e2e:build`) measured the real, much larger
post-generate-code population and reported an apparent "regression" against
a ceiling that was never actually about that population. This is not a
one-off: it is why "CI green / local gate red on the identical commit" kept
recurring for this specific step (see `gate-exemption-must-be-machine-
checkable.md` for two earlier, differently-caused instances of the same
"gate ≠ CI" failure class).

A related, root-level cause: `AGENTS.md`'s "Generated-code prerequisites
for gates" section named `npm run lint` (alongside `npx tsc --noEmit`) as
an example of a gate needing `generate-code` run first when executed in
isolation. That rationale (avoiding false-positive TypeScript errors from
handwritten files that import generated entity code) is real for `tsc`,
but does not apply to `eslint` here — `eslint.config.mjs` sets no
`parserOptions.project`, so linting is not type-aware and a missing
generated import cannot produce a false-positive the way it does for
`tsc`. CI's own `Lint` job proves this empirically: it has always run `npm
run lint` with zero `generate-code` prerequisite and always passed. That
AGENTS.md line was itself pointing agents toward reproducing this bug on
every isolated lint run; it's corrected as part of this fix.

## Fix applied

`npm run lint` is now the **first** step in every affected Completion gate
(`update-generator.md`, `generate-schema.md`, `update-code.md`,
`add-component.md`), before any step that triggers `generate-code`. On a
fresh worktree this is automatically the pre-generate-code state. On a
worktree reused from an earlier session (where `generate-code` already
ran), run `npm run cleanup` immediately before this step to remove the
generated output — **not** `git clean`, which CLAUDE.md's D004 forbids
unconditionally. `AGENTS.md`'s "Generated-code prerequisites for gates"
section now names `npm run lint` as the one exception that must *not* be
prefixed with `generate-code`. This makes the local gate's lint step and
CI's `Lint` job check the literal same file population under the literal
same command, so they report the same number by construction — no
dedicated bisection or "is this really a regression" investigation should
ever be needed for this step again.

Each affected `.claude/commands/*.md` file's "isolated debug" footer note
was also updated to stop telling readers to prefix `npm run lint` with
`generate-code` — it now only applies to `tsc`/typecheck, matching the
corrected `AGENTS.md` rule. `review-performance.md`, `review-security.md`,
and `review-tenancy.md` carry the same stale footer note but are out of
scope for this fix (their advisory note governs ad-hoc debugging, not a
blocking Completion gate, so the practical impact is much lower) —
flagged here as follow-up cleanup, not addressed in cmd_600.

## What this does *not* fix

The post-generate-code warning count (93 at `c10b1b1a`/`c78bfef3`, ~82-83
currently) is real generated-code lint debt — genuinely unused
`deps`/`records` callback parameters and similar in generated Cypress
specs/helpers (see `lint-warning-ceiling-ratchet.md` "Known remaining
warnings" and an addendum report's cost estimate for fixing
it at the generator/template level, entity-by-entity). No CI job and, as of
this fix, no local gate step checks that population at all — it is
invisible to automation. Raising the current `N=20` ceiling to
accommodate ~93 was considered and rejected: CI's Lint job would still
report ~15 for the same commit, so raising the ceiling could not make
local and CI report the same number (the task's actual requirement), it
would only launder an unrelated, much larger population under a ceiling
meant for a different one. Reducing the generated-code warning count
itself (entity-level template flags in `test_spec.cy.ts.jinja2` /
`test_api_spec.cy.ts.jinja2` to only emit the `deps`/`records` references
an entity's fields actually use) remains unstarted, tracked work — a
worthwhile follow-up cmd, but out of scope here since it's a generator
correctness improvement, not a gate-mechanism fix.
