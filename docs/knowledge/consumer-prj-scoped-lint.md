# Consumer-side lint is scoped to prj/, not a copy of this repo's own lint

**Rule**: a consumer project (app-template, inventory-app, ...) that
embeds this repo as a submodule must not run this repo's own `npm run
lint` (`eslint --max-warnings 20`, unscoped — lints this repo's entire
tree) as its lint gate, either before or after `generate-code`. Neither
ordering is correct for a consumer:

- Before `generate-code`: identical to this repo's own gate/CI, so it
  never actually looks at anything the consumer wrote (`prj/`).
- After `generate-code` (the bug this doc's companion fix addresses,
  cmd_682): measures this repo's own templates *plus* every file
  `generate-code` instantiates per entity in the consumer's real schema
  — hundreds of pre-existing, per-entity warnings unrelated to `prj/`'s
  own content, none of which this repo's own gate/CI has ever measured
  (this repo has no schema of its own to generate against). A consumer
  schema change that touches nothing in `prj/` can still fail this way,
  for reasons entirely disconnected from what was actually changed.

**Fix (cmd_683, 2026-08-13, a decision on the two candidates the
`subtask_664b` investigation report compared)**:
`scripts/lint_prj_synced.py` (wired up as `npm run lint:prj`) runs
`prj:sync`, takes prj_sync.py's own `copied`/`merged` stdout lines as
the list of what was just synced (never re-derives that list by
independently walking `../prj`), filters to `.ts`/`.tsx`, and lints
exactly those files at their synced destination paths inside this repo.
A consumer calls this through the submodule:
`npm --prefix app-generator run lint:prj`.

## Why scoping to prj/ does not conflict with `lint-gate-must-match-ci-precondition.md`

This repo's own `lint` step (see that doc) must run *before*
`generate-code` for one reason: to match what this repo's own CI Lint
job measures (`npm ci && npm run lint`, no `generate-code`). That is a
"keep the population identical to CI's" rule specific to *this
repo's own* gate.

`lint:prj` is a different mechanism measuring a different, narrower
population by design (per the decision reached in cmd_683 on the
cmd_664 investigation: a consumer's lint is not a copy of this repo's
lint — this repo's own code is already covered by this repo's own CI).
Because the population is explicitly limited to whatever `prj:sync` just
reported (never "the whole tree, whatever state it's in"), running
`lint:prj` after `generate-code` does not enlarge what gets measured —
`prj:sync`'s output list is the same regardless of whether
`generate-code` has run yet. There is no precondition to match here,
because there is no larger, unscoped population for ordering to
accidentally expose. A consumer project's gate can therefore run `npm
run lint:prj` at any point after `prj:sync` (in practice: as early as
possible, right after `prj:sync`, purely so the false-population bug
this doc's companion fix removed does not get silently reintroduced by
someone reordering steps without understanding why the old order was
wrong — see each consumer repo's own `generate-schema.md` for the
corrected step order and its own worked example).

## Fail-closed on measurement, not on empty result

`lint:prj` exits non-zero if `prj:sync` could not be observed running
against a real `../prj` — no `../prj` sibling directory at all, or a
`../prj` that exists but from which `prj:sync` synced zero files of any
kind. It does **not** fail merely because none of the files `prj:sync`
did observe and sync happen to be `.ts`/`.tsx` — a consumer whose
`prj/` holds only e.g. schema/SQL/migration files and no hand-written
TypeScript is a legitimate state, not a temporary gap to be treated as
red (2026-08-15 product decision). The earlier version of this script
conflated the two: "zero `.ts`/`.tsx` files to lint" was itself the
fail-closed trigger, which meant a consumer that had genuinely synced
real content — just none of it TypeScript — failed exactly like a
consumer whose `prj:sync` never ran at all. Those are not the same
failure mode, and only one of them is actually a bug.

The distinction now driving the gate: did `prj:sync` observe and report
on a real `../prj` (pass, whatever it found), or did it fail to observe
one at all (fail)? This still mirrors this repo's own "no silent green"
principle applied to the earlier candidate (i) investigation
(`subtask_664b`): its naive invocation (`../prj/**` passed directly to
ESLint with this repo's `cwd`) hit ESLint's `--config`-implies-fixed-
base-path behavior and reported `File ignored because outside of base
path` for every file — 0 files linted, exit 0, without `prj:sync` ever
running against a real `../prj` at all. A gate that can go green without
ever actually measuring anything is worse than one that fails loudly;
`lint:prj` refuses to reproduce that shape by construction, checking
what `prj:sync` actually observed before ever invoking ESLint, rather
than trusting ESLint's own exit code to reflect "nothing to check" as a
failure (it does not — ESLint given zero targets is a no-op with exit
0).

Verified directly, three scenarios:
- No `../prj` sibling at all: `npm run lint:prj` → `prj:sync: no
  ../prj, skipping` → `FAIL-CLOSED` → exit 1.
- A real `../prj` synced successfully but holding no `.ts`/`.tsx`
  content (only e.g. a `.prisma` file) — the case this fix exists
  for: `prj:sync: copied ...` → `PASS -- ... none of them .ts/.tsx`
  → exit 0. Reproduced directly against a real consumer's actual
  `prj/` content (copied read-only into a scratch directory, the
  consumer's own working tree never touched), whose `prj/` holds only
  `.prisma`/`.sql`/`.toml`/`.yaml` files and zero `.ts`/`.tsx`: the
  prior implementation failed closed on this exact content, the fixed
  implementation passes.
- A real `../prj` with one syntactically-broken `.ts` file: linted and
  correctly failed (exit 1, ESLint parse error surfaced) — confirming
  the fail-closed-on-measurement-failure check does not substitute for
  ESLint actually running once `.ts`/`.tsx` files are present.

## No warning ceiling, unlike this repo's own `lint`

`lint:prj` does not pass `--max-warnings` to ESLint — it only fails on
ESLint errors (or the zero-files check above), matching what
`subtask_664b`'s own investigation measured as success ("exit 0, 0
errors, N warnings"). This repo's own `--max-warnings 20` was calibrated
for this repo's own small, stable template surface and copied verbatim
into a consumer's plain `npm run lint` delegate before this fix — but a
consumer's `prj/` content is expected to grow over time as hand-written
specs/source are added there, and a ceiling inherited from an unrelated
population is not a meaningful signal for it (measured directly during
cmd_682/683: one consumer's `prj/`-scoped warning count grew from 3 to
43 in a single day between the two commands, entirely from new
hand-written Cypress specs, not from any defect). Whether `prj/` content
should eventually get its own warning ceiling is a separate, not-yet-
decided question, tracked on the dashboard, not resolved by this fix.

## Where the mechanism lives

The script lives in this repo (`scripts/lint_prj_synced.py`), not
duplicated per consumer — consumers reach it through the submodule
(`npm --prefix app-generator run lint:prj`). Placing it per-consumer
would repeat a failure mode this project has hit before: a fix placed
in one consumer and not the other goes stale in whichever one didn't
get it (see `CLAUDE.md`'s Language Policy section and the general
"generator changes belong in the generator" topology this repo and its
consumers already follow for every other cross-cutting mechanism).
