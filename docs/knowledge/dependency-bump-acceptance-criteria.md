# Dependency Bump Acceptance Criteria

**Status: Adopted**
**Author: the design reviewer (subtask_459b_process_gap)**
**Date: 2026-07-26**

---

## Problem

When an agent runs `npm update` or `npm install <pkg>` to bump a
dependency, `npm audit` may exit 0 even if `package-lock.json` is left
incomplete — indirect dependency entries can be silently dropped from the
lockfile. CI uses `npm ci`, which validates lockfile structural completeness;
the corruption is invisible locally until CI runs.

Two incidents of this failure pattern occurred within one week on the same
project (cmd_442→cmd_443, subtask_457j_i2_fix→cmd_459). A process-level
rule is required to prevent recurrence.

**Update (2026-07-29, cmd_483): a third incident occurred with the Rule
below already in force** (cmd_482 ran and passed both required checks
locally, then broke CI after merge anyway). See Incident 3 and "Why the
Rule wasn't enough the third time" below — the Rule as originally written
had a silent gap: it never said *which* `npm` binary must produce the
exit-0 result.

---

## Rule

**Any task that bumps a direct or indirect npm dependency MUST include both
of the following acceptance criteria:**

1. **`npm ci` exits 0** — validates that `package-lock.json` is complete
   and installable on a clean node_modules. This is the check that catches
   lockfile corruption that `npm audit` misses.

2. **`npm audit --omit=dev --audit-level=high` exits 0** — validates that
   no high/critical vulnerabilities are introduced by the bump.

`npm audit` alone is **insufficient** as the sole acceptance criterion for
dependency bump tasks.

### Why npm audit alone is not enough

`npm audit` inspects the set of resolved package names and versions reported
in the lockfile. It does **not** verify that every indirect dependency entry
is present and resolvable. A bump can:

- Add an entry for the bumped package ✓
- Leave indirect dependency entries (`@emnapi/runtime`, postcss peer deps,
  etc.) absent or at incorrect resolution levels ✗

`npm ci` enforces structural lockfile integrity: it fails with an explicit
error listing the missing entry (e.g.
`Missing @emnapi/runtime@1.11.2 from lock file`).

### Why the Rule wasn't enough the third time (cmd_483)

Incident 3 (below) happened with both required ACs satisfied, verified,
and quoted verbatim in the landing commit message. The gap: **`npm ci`
exits 0 or 1 depending on which `npm` binary runs it, on the exact same
lockfile.**

This repo (as of Incident 3) pinned neither `packageManager` nor
`engines.npm`, and `.github/workflows/ci.yml` requested a floating
`node-version: '24'` — so CI silently tracks whatever npm ships inside
GitHub's latest `node:24` runner image at the moment the job happens to
run, with no record of which patch that was at authoring time. On
2026-07-29, CI resolved to node v24.18.0 / npm 11.16.0. The agent's local
shell had node v24.13.0 / npm 11.6.2.

Reproduced directly: on the *identical* (broken) lockfile, `npm ci` with
local npm 11.6.2 succeeds (exit 0); `npx npm@11.16.0 ci` (same node,
CI's npm) fails with the exact `Missing: @emnapi/{runtime,core} from lock
file` error CI reported. Newer npm enforces stricter lock/package.json
sync validation than the older local one — the same lockfile is
structurally invalid by npm 11.16's rules and structurally tolerated by
npm 11.6's. **"`npm ci` exits 0" is necessary but not sufficient as
written; it must be run with the same npm CI uses, or it can pass locally
on a lockfile that CI will reject.**

A second, independent gap compounded this: `.github/workflows/ci.yml`'s
`pull_request` trigger only covers PRs targeting `main`/`master`. This
project lands work through an intermediate `doreen/import` branch;
subtask PRs merging into `doreen/import` (including all three incidents'
PRs — confirmed via `gh pr checks`/`gh api .../check-runs`: zero CI
check-runs exist against any of PR #196, #197, #198, or #199's own head
commits) get **no CI run at all** before merge. All three incidents were
only ever caught *after* merge, as a side effect of a separate, standing
`doreen/import → main` PR re-triggering its own CI once the (already
merged) broken commit became part of its diff. Nothing blocked the merge
itself — detection was downstream and incidental, not a gate.

---

## Checklist for Dependency Bump Tasks

When writing or reviewing an agent task that bumps any npm dependency,
confirm the task YAML's `acceptance_criteria` includes:

```yaml
acceptance_criteria:
  - npm ci exits 0, run with the same npm version CI uses (clean node_modules,
    not npm install — npm ci validates lockfile integrity; see cmd_483:
    a lockfile can pass npm ci on an older/newer local npm and still fail
    CI's npm on the identical file. Check CI's actual resolved npm version
    from a recent run's "Environment details" setup-node log step, or use
    the version pinned in package.json's engines.npm once cmd_483's fix lands)
  - npm audit --omit=dev --audit-level=high exits 0
  - git diff package-lock.json reviewed for unexpected transitive changes
```

The third item (diff review) is recommended for all bumps and mandatory
when bumping peer-dependency-heavy packages (postcss, babel, webpack,
esbuild, napi-rs stack).

---

## Incidents

### Incident 1: cmd_442 → cmd_443 (2026-07-24)

- **Package bumped**: `@emnapi/runtime` and related `@napi-rs/*` stack
- **Failure mode**: `package-lock.json` missing `@emnapi/runtime@1.11.2`
  entry after bump
- **Detection**: CI `npm ci` exit 1 with explicit missing-entry error
- **AC at the time**: `npm audit` only — `npm ci` exit 0 not required
- **Repair**: `git restore package-lock.json && npm install --package-lock-only`
  (see the Repair Procedure section below)
- **Repair task**: cmd_443

### Incident 2: subtask_457j_i2_fix → cmd_459 (2026-07-26)

- **Package bumped**: `postcss` 8.5.15 → 8.5.23
- **Failure mode**: `package-lock.json` lockfile corruption after postcss update
- **Detection**: CI all-red (all checks failing)
- **AC at the time**: `npm audit` only — `npm ci` not listed in acceptance
  criteria for the bump subtask
- **Hotfix task**: cmd_459 subtask_459a (parallel dispatch)

### Incident 3: cmd_482 → cmd_483 (2026-07-29)

- **Change**: cmd_482 (subtask_482a, PR #199) resolved 5 dev-only npm
  audit high-severity CVEs via `npm audit fix` (non-force) plus two
  scoped `package.json` `overrides` edits (minimatch pin, npm-run-all →
  npm-run-all2 swap).
- **Failure mode**: identical shape to Incidents 1–2 — `package-lock.json`
  top-level `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime`
  entries silently dropped; the sibling `node_modules/@emnapi/wasi-threads`
  entry (same optional wasm32 chain, reached via
  `@tailwindcss/oxide-wasm32-wasi` / `@img/sharp-wasm32`) survived.
  Confirmed via `git log --oneline -S'"node_modules/@emnapi/core":' --
  package-lock.json`: commit `09cf87b` (cmd_482) is the exact commit that
  removed both lines.
- **Detection**: not PR #199's own CI (none ran — see the CI-trigger gap
  below) — caught only after merge, by the standing `doreen/import → main`
  PR's `npm ci` step re-running against the new merge commit.
- **AC at the time**: both Rule items (`npm ci` exit 0, `npm audit
  --omit=dev --audit-level=high` exit 0) were in force and were satisfied
  — verified locally, quoted in the commit message, per the Rule as
  written. The Rule's `npm ci` step ran under the agent's local npm
  (11.6.2 at the time), which does not reject this lockfile; CI's npm
  (11.16.0) does. See "Why the Rule wasn't enough the third time" above
  for the full mechanism and the CI-trigger-scope gap found alongside it.
- **Repair task**: cmd_483 (this document's update)

---

## Repair Procedure

If `npm ci` fails after a dependency bump has landed:
→ `git restore -- package-lock.json` to restore the last known-good committed state, then
  `npm install --package-lock-only` to regenerate missing structural entries without
  changing any pinned version. See Incident 1 above for a worked example.

---

## Structural Fixes Considered (cmd_483, after the 3rd recurrence)

A per-task checklist item has now failed to prevent recurrence three
times despite being followed correctly each time (Incident 3 passed the
Rule as literally written). This section documents the structural options
considered instead of a fourth checklist addendum.

### (a) Pin the toolchain, so local verification can't silently diverge from CI

**Implemented in cmd_483** (low-risk, scoped to this repo, no CI trigger
changes):

- `package.json`: added `"packageManager": "npm@11.16.0"` (informational
  record of the version CI resolved to at the time of this fix) and
  `"engines": {"npm": "^11.16.0"}`.
- `.github/workflows/ci.yml`: pinned all 4 jobs' `node-version` from the
  floating `'24'` to the exact `'24.18.0'` CI was actually resolving to,
  so CI itself stops silently drifting to whatever patch GitHub's runner
  image happens to carry on a given day.

**Deliberately NOT implemented: `.npmrc` `engine-strict=true`.** This was
tried and reverted after discovering its blast radius: `engine-strict`
enforces *every* installed package's `engines` field, not just the root
project's. With it on, `npm ci` hard-fails locally on `node`-version
mismatches from unrelated transitive packages (e.g.
`npm-normalize-package-bin@6.0.0` requiring `node ^24.15.0`), regardless
of npm version. The development environment's node version is shared
across every contributor session working in this repo and is not
something a single task can or should upgrade unilaterally — doing so
would break every future local `npm install`/`npm ci` until someone
separately bumps the shared node install, which is an environment change
outside a single dependency-bump task's scope. Without `engine-strict`,
the `engines.npm` field still surfaces a visible `EBADENGINE` warning
naming the exact mismatch on every local install — enough to make drift
visible without blocking work.

**Limitation**: tool pinning makes version drift *visible* (a warning) and
gives both humans and automation a single source of truth for "what
version should this be run with" — but by itself it doesn't force
compliance, and it does nothing to change the fact that PRs merge into
`doreen/import` completely unchecked (see (b)).

### (b) A read-only lock-drift gate that actually runs before merge

**Proposed, not implemented — needs a decision, since it changes CI
trigger scope and cost repo-wide.**

The bigger finding from this investigation: `.github/workflows/ci.yml`'s
trigger is `pull_request: branches: [master, main]` only. Every one of
Incidents 1–3 merged into `doreen/import`, which is neither — confirmed
zero CI check-runs exist against PR #196, #197, #198, or #199's own head
commits (`gh pr checks <n>` / `gh api commits/<sha>/check-runs`). CI only
ran, and only caught the break, as an accidental side effect of a
separate standing `doreen/import → main` PR re-triggering post-merge.

**The gate**: add a lightweight job — either by extending the existing
`pull_request` trigger to also cover `doreen/import`, or a new workflow
scoped with `paths: ['package.json', 'package-lock.json']` triggering on
PRs targeting `doreen/import` — that runs, under CI's own pinned
node/npm:

```yaml
- run: npm install --package-lock-only
- run: git diff --exit-code package-lock.json
```

If the lockfile the PR ships doesn't match what a clean `npm install
--package-lock-only` produces under CI's toolchain, the job fails with a
diff attached, before merge. This is read-only in the sense that matters:
it never commits anything back to the branch — `package-lock.json` in
this repo is already tracked and committed (unlike a repo that
regenerates an untracked lockfile on every CI run), so a diff-and-fail
check here cannot introduce drift of its own. It also fully subsumes the
(already-mandatory) `npm ci` check for this specific failure class, since
a lockfile that fails this diff check is by definition one `npm ci` would
also reject under the same toolchain — but it reports the *cause* (a
diff) instead of a downstream symptom (a missing-entry error), and it
runs pre-merge instead of relying on an unrelated PR's incidental
re-trigger.

**Tradeoffs**: adds a CI job (Actions-minutes cost, small — this step
alone is seconds, not the full `npm ci` + build + e2e suite) and a small
amount of latency to every subtask PR that touches these two files.
Extending the trigger to `doreen/import` also means *all* existing CI
jobs (lint, unit, e2e) start running per-subtask-PR rather than only
against the standing integration PR — a larger cost/latency change than
just the lock-drift job, and a workflow-trigger-scope decision with
repo-wide effect that this task did not judge itself authorized to make
unilaterally.

### Recommendation

Adopt **(b)** as the primary fix, scoped narrowly: a new, small,
`paths`-filtered workflow (not an extension of the full existing `ci.yml`
job matrix) that triggers only on PRs targeting `doreen/import` touching
`package.json`/`package-lock.json`, running only the two-line
install-and-diff check above. This directly closes the actual gap all
three incidents share — nothing gated the merge — without taking on the
cost of running the full test suite twice per subtask PR. Keep **(a)**
(already landed) as cheap, always-on, complementary defense in depth: it
makes drift visible locally the moment it happens, both for the (b) job's
lockfile-writing step (run under CI's own pinned toolchain either way)
and for anyone who happens to check warnings before pushing.

(b) is a trigger-scope/workflow change with repo-wide cost implications;
this task implemented (a) only and leaves (b) as a recommendation
pending sign-off, per the reasoning above.

## CI Audit Gate Design: Blocking + Non-Blocking Split (cmd_482, Option 5)

### Background

cmd_482 found 5 dev-only high-severity CVEs (`axios`, `brace-expansion`,
`linkify-it`, `shell-quote`, `systeminformation`) that had accumulated
undetected, because the existing `audit` job's `npm audit --omit=dev
--audit-level=high` step is scoped to production dependencies only by
design (see the job's own inline comment in `ci.yml`), and dev-only
findings were otherwise expected to be caught by Dependabot — a mechanism
that, at the time, was itself broken for a different reason (see
`doreen/subtask_481a_dependabot_ci_missing_secret_fix`). The result: a
class of finding with no active detection path.

Several options were weighed (blocking the existing gate on all scopes,
lowering the blocking threshold to `moderate`, a time-boxed exception
list, status quo). The adopted design **keeps the existing blocking gate
unchanged** and adds a **non-blocking, full-scope companion job** instead
of widening what blocks merge. Full reasoning and the options considered
are captured in the subtask_482a design record for this task.

### The design

1. **Blocking gate (`audit` job) — unchanged.**
   `npm audit --omit=dev --audit-level=high` continues to gate merges on
   production-dependency high/critical CVEs only. Dev-only findings never
   block a PR under this job, by design — dev tooling ships to CI runners
   and contributor machines, not to the deployed product.

2. **Non-blocking gate (`audit-full-scope` job) — new, added in cmd_482
   subtask_482b.** Runs `npm audit --audit-level=high` (no `--omit=dev`,
   so it covers the full tree including devDependencies) in its own job,
   with `continue-on-error: true` on the audit step. A finding here never
   fails the job or the workflow run — it exists purely as a visibility
   mechanism for the class of finding the blocking gate deliberately
   excludes.

   Output is surfaced two ways, both written unconditionally
   (`if: always()`) regardless of whether the audit step itself failed:
   - A markdown table in the job's `$GITHUB_STEP_SUMMARY` — severity
     counts (critical/high/moderate/low/total), visible directly on the
     Actions run page without opening logs.
   - A JSON artifact (`npm-audit-full-scope`, `retention-days: 30`) —
     the raw `npm audit --json` output, kept so a later automation step
     or a maintainer can inspect exact package/advisory detail beyond the
     summary counts, without re-running the audit locally. Adopted
     because the marginal cost is one small JSON file per run; a
     summary-only design was rejected because "how many" without "which
     package" is not enough to act on without re-running the audit by
     hand.

   Verification that this job structure genuinely never fails CI (not
   just "should" by convention) is captured in the subtask_482b
   implementation record: a known high/critical-severity dependency was
   deliberately installed in an isolated worktree, the real `npm audit
   --audit-level=high --json` command was confirmed to exit non-zero
   against it, and the exact `continue-on-error: true` step pattern used
   in this job was run end-to-end via `nektos/act` and confirmed to still
   produce a successful job outcome.

3. **Who reviews the non-blocking job's output, and how often, is an
   operational (not code) concern** and is tracked in this project's
   internal task-management process rather than in this file — a
   non-blocking job whose output nobody reads reproduces the exact
   visibility gap that caused cmd_482 in the first place, so that review
   step is treated as a load-bearing part of this design, not an
   afterthought, even though its specifics live outside this repository.

---

## Related Documents

- `docs/knowledge/submodule-pointer-bump-policy.md` — analogous policy
  for submodule pointer bump tasks
