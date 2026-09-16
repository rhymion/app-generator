# README.md / README_ja.md sync: machine gate + agent procedure

**Rule**: a branch's diff must touch README.md and README_ja.md together —
never one without the other. This is a two-tier design; the two tiers check
different things and are not interchangeable:

1. **Machine gate (`npm run check:readme-sync`, `scripts/check_readme_sync.sh`)**
   — proves both files were *touched* relative to the branch's base
   (`origin/develop` by default, or an explicit ref passed as `$1`). This is
   structurally checkable from a `git diff`, so it is enforced as a fail-closed
   Completion gate step (see the task types listed below) — it exits non-zero
   the moment README.md differs from base and README_ja.md doesn't (or the
   reverse). Local-only: it never calls out to CI, and CI is not a
   prerequisite for it to run.
2. **Agent procedure** — proves the two files actually say the *same thing*.
   Content parity cannot be checked mechanically (translation quality,
   equivalent scope, matching section structure), so it is handled as a task
   step: whenever a task's diff includes a README.md change, bring
   README_ja.md up to date with it as part of finishing that task (and vice
   versa), before the machine gate runs, not as a separate follow-up.

Do not try to fold tier 2 into tier 1. A script cannot judge whether a
translation is faithful; only tier 1 (mechanical "was it touched") belongs in
the Completion gate, and only tier 2 (actual content work) belongs in the
task's own steps.

## Why this exists

A generator feature's README.md entry (a new `x-*` schema key) landed on
`develop` without its README_ja.md counterpart — the feature commit touched
only README.md, and nothing caught the gap before merge. The missing
translation was added by hand in a follow-up commit after the fact. Nothing
in the workflow at the time would have caught this before merge: there was
no mechanical check tying the two files' diffs together, and the existing
sync procedure for content parity only helps once someone remembers to
invoke it.

## Where the gate is wired in

`npm run check:readme-sync` is a Completion gate step in every task type
whose scope can include a README.md change: `add-component.md`,
`generate-schema.md`, `update-code.md`, `update-generator.md`. It is
deliberately **not** wired into `investigate.md` (its Completion gate is
`None` — no files are modified) or the `review-*.md` types (read-only,
`npm audit` only, no code changes).

Docs-only changes have no dedicated task type of their own in this repo's
`.claude/commands/`; they are scoped under whichever of the four
implementation task types the associated code change falls under, so the
gate step already covers them there. If a docs-only task type is ever added,
this step belongs in its Completion gate too.

## Base ref and scope

The gate compares against the merge-base of `HEAD` and `origin/develop` by
default — the actual integration branch both files are expected to converge
on. Pass an explicit ref (`bash scripts/check_readme_sync.sh <ref>`) to
compare against something else. The check does not (and cannot) inspect the
consumer repos' own README.md/README_ja.md pairs — those are independently
authored, separately versioned files that happen to share this repo's
two-language convention, not files this repo's build ever writes to. Extend
this gate to a consumer repo only if that repo's own README churn rate ever
warrants it — as of this writing it has stayed effectively static there.
