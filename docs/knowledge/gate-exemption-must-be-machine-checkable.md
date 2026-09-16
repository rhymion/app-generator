# Gate exemptions must be machine-checkable, or unconditional

**Rule**: a Completion gate step in `.claude/commands/*.md` may only be
written as "skip this unless/if X" when something actually checks X before
skipping — a script, a `git diff --name-only` grep, an explicit human
confirmation recorded in the report. A prose exemption that relies on the
executing agent correctly self-assessing "did my own change touch the
excluded area?" is not a gate condition; it is a wish. If CI runs the step
unconditionally (no path filter), an unenforced local exemption will
eventually go green locally and red in CI on the same commit.

## Why this keeps recurring

CI jobs in this repo have no `paths:` filters — every job (`lint`,
`unit-tests`, `pytest`, `audit`, `e2e-tests`) runs on every push and PR to
`main`/`master`, regardless of which files changed. But several
`.claude/commands/*.md` Completion gates were written with a *conditional*
skip for the equivalent local step, based on the task author's belief about
what that task type "usually" touches. The two things are structurally
guaranteed to diverge the moment reality doesn't match the belief, and
nothing in the workflow catches the divergence before push — it surfaces
only as a red CI job on an otherwise-complete PR.

This is the third occurrence of "gate that diverges from CI" in this repo:

1. **Occurrence 1** (`4617bb7`): the `unit-tests` CI job ran
   `npm ci` then `db:generate` then `npm test`, but never `generate-code`
   -- so a tracked unit test whose subject imports generator-emitted code
   failed in CI (module not found) even though it was correct. The gate
   doc assumed CI's job would have the same prerequisites the local gate
   steps run in sequence; the actual job config didn't. See
   `troubleshooting.md` section 2.4 for the fix (dependency injection
   instead of static import of generated code) and the CI job correction.
2. **Occurrence 2** (`d08e3b9`): the same CI job invoked
   `npm test` (bare vitest, watch-mode script name) while the gate matrix
   documented the canonical command as `npm run test:vitest`. Functionally
   equivalent in this repo's non-interactive CI runner, but the command
   string CI actually ran and the command string the docs told a
   human/agent to run had drifted apart.
3. **Occurrence 3** (this doc): `update-generator.md`'s Completion gate carried
   a line stating that the vitest step is skipped because component code
   is unchanged, unless explicitly modified. A prior change normalizing
   enum casing changed `components/_standard/ApprovalSection.tsx` and
   `actions_core.ts` -- squarely the condition under which the exemption's
   own stated rule says vitest must run. Nothing checked the condition;
   the exemption was applied anyway; a tracked unit test's stale stub
   values went unnoticed locally and failed the main-branch PR's Unit
   Tests job. The identical prose pattern was present in four of
   app-generator's eight gate docs and mirrored into three of
   app-template's four gate docs.

## Fix applied

Rather than build path-based detection logic to make the exemption
machine-checkable (which is itself new logic that has to stay correct
forever, and CI already runs both the Python and vitest unit-test jobs
unconditionally regardless), the affected gate docs now run both steps
unconditionally, with no exemption language. This exactly matches what CI
already enforces for app-generator's own gate docs, and -- since the
affected app-template task types already forbid touching `app-generator/`
at all -- makes the two steps a cheap confirmation that the "do not touch
app-generator/" scope rule was actually followed in app-template's case,
rather than a source of new local-gate failures.

## When a conditional exemption is still acceptable

The investigation and review-only task types keep a genuine
unconditional-none/audit-only gate: this is not the same failure class,
because those task types make no commits and no push, so CI never runs on
their output. A conditional exemption is only dangerous when the task type
does push code that triggers an unconditional CI job.

## Known remaining gap (not fixed here -- candidate for a follow-up task)

Three of app-generator's gate docs require the API-only Cypress suite
locally, while CI's end-to-end job runs the full suite with no spec
filter. This is a known, already tracked gap, not new here.

Separately, the same three gate docs require an npm vulnerability audit
locally but not the Python equivalent, while CI's audit job runs both
unconditionally. This is a newly observed instance of the same "gate does
less than CI" shape, surfaced during this task's survey; left unfixed here
as a lower-urgency, better-scoped-separately item since a stale-CVE audit
failure is a slow-moving risk, unlike the actively-blocking gap this task
fixed. The review-only task types' audit-only gate has the same narrower
gap for the same reason.
