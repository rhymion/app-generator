# Dependency Bump Acceptance Criteria

**Status: Adopted**
**Author: the design reviewer**
**Date: 2026-07-26**

---

## Problem

When an agent runs `npm update` or `npm install <pkg>` to bump a
dependency, `npm audit` may exit 0 even if `package-lock.json` is left
incomplete — indirect dependency entries can be silently dropped from the
lockfile. CI uses `npm ci`, which validates lockfile structural completeness;
the corruption is invisible locally until CI runs.

Two incidents of this failure pattern occurred within one week on the same
project (Incident 1, Incident 2). A process-level
rule is required to prevent recurrence.

**Update (2026-07-29): a third incident occurred with the Rule
below already in force** (the triggering change ran and passed both required checks
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

### Why the Rule wasn't enough the third time

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
    not npm install — npm ci validates lockfile integrity; see Incident 3:
    a lockfile can pass npm ci on an older/newer local npm and still fail
    CI's npm on the identical file. Check CI's actual resolved npm version
    from a recent run's "Environment details" setup-node log step, or use
    the version pinned in package.json's engines.npm once this fix lands)
  - npm audit --omit=dev --audit-level=high exits 0
  - git diff package-lock.json reviewed for unexpected transitive changes
```

The third item (diff review) is recommended for all bumps and mandatory
when bumping peer-dependency-heavy packages (postcss, babel, webpack,
esbuild, napi-rs stack).

---

## Incidents

### Incident 1 (2026-07-24)

- **Package bumped**: `@emnapi/runtime` and related `@napi-rs/*` stack
- **Failure mode**: `package-lock.json` missing `@emnapi/runtime@1.11.2`
  entry after bump
- **Detection**: CI `npm ci` exit 1 with explicit missing-entry error
- **AC at the time**: `npm audit` only — `npm ci` exit 0 not required
- **Repair**: `git restore package-lock.json && npm install --package-lock-only`
  (see the Repair Procedure section below)
- **Repair task**: applied the same day.

### Incident 2 (2026-07-26)

- **Package bumped**: `postcss` 8.5.15 → 8.5.23
- **Failure mode**: `package-lock.json` lockfile corruption after postcss update
- **Detection**: CI all-red (all checks failing)
- **AC at the time**: `npm audit` only — `npm ci` not listed in acceptance
  criteria for the bump subtask
- **Hotfix task**: applied the same day (parallel dispatch)

### Incident 3 (2026-07-29)

- **Change**: PR #199 resolved 5 dev-only npm
  audit high-severity CVEs via `npm audit fix` (non-force) plus two
  scoped `package.json` `overrides` edits (minimatch pin, npm-run-all →
  npm-run-all2 swap).
- **Failure mode**: identical shape to Incidents 1–2 — `package-lock.json`
  top-level `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime`
  entries silently dropped; the sibling `node_modules/@emnapi/wasi-threads`
  entry (same optional wasm32 chain, reached via
  `@tailwindcss/oxide-wasm32-wasi` / `@img/sharp-wasm32`) survived.
  Confirmed via `git log --oneline -S'"node_modules/@emnapi/core":' --
  package-lock.json`: commit `09cf87b` is the exact commit that
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
- **Repair task**: this document's update

---

## Repair Procedure

If `npm ci` fails after a dependency bump has landed:
→ `git restore -- package-lock.json` to restore the last known-good committed state, then
  `npm install --package-lock-only` to regenerate missing structural entries without
  changing any pinned version. See Incident 1 above for a worked example.

---

## Structural Fixes Considered (after the 3rd recurrence)

A per-task checklist item has now failed to prevent recurrence three
times despite being followed correctly each time (Incident 3 passed the
Rule as literally written). This section documents the structural options
considered instead of a fourth checklist addendum.

### (a) Pin the toolchain, so local verification can't silently diverge from CI

**Implemented as part of this fix** (low-risk, scoped to this repo, no CI trigger
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

**Not adopted.** This section originally proposed a fix that baked the
working branch name (`doreen/import`) directly into `.github/workflows/
ci.yml`'s trigger scope. Per a standing project policy against
committing temporary, branch-name-specific settings into CI config (a
`doreen/import`-scoped trigger was separately and deliberately removed
from `ci.yml` for this same reason — that removal was intentional, not
an incident or a reporting error), that specific remedy is withdrawn.

**The original finding in this section also overstated the gap and has
been corrected below** (verified directly against CI history, not
re-asserted from the original write-up): the actual detection/gating
picture has two tiers, not one missing gate.

- **Subtask PR → `doreen/import`**: no per-PR CI. Confirmed zero
  check-runs against PR #196–#199's own head commits. Quality evidence
  for these PRs comes from local runs (mandatory gate, pytest) in an
  isolated worktree, not CI.
- **`doreen/import` → `main`** (the standing PR, currently #121): **CI
  does run here, on every push to `doreen/import`, and it does gate the
  merge** — merges are not made while this CI is red. Verified directly:
  `9f6a119` (the merge of Incident 3's breaking PR #199 into
  `doreen/import`) shows Lint/Unit/E2E/Dependency Audit all `failure` on
  PR #121's CI; `74386f9` (the merge of the repair PR #200) shows all
  five checks `success`. The same failure → repair pattern holds for
  Incident 1 (`7fa1fc2` failure → `cc147b2` success). Separately, `main`'s
  tip (`4a15b71`) predates all three incidents — `git merge-base
  --is-ancestor` confirms none of the three incidents' breaking or repair
  commits are reachable from `main` — so `main` itself has never absorbed
  any of the three broken lockfile states. This gating is intentional and
  already relied upon: the 3.0.0 hard-gate policy is built on top of it.
  It should not be characterized as a hole.

**The actual, narrower gap**: a broken commit that lands on `doreen/import`
(tier one, unchecked) is only *detected* the next time tier two's CI
happens to re-run — which, given `doreen/import → main` is a
long-lived standing PR, can be a meaningful delay. During that window
the broken commit is a live base for any other subtask work branching
from `doreen/import`, even though `main` itself stays protected
throughout. This is a detection-latency problem at the `doreen/import`
tier, not an absence of gating at the `main`-merge tier — the three
recurrences are explained by that latency (each incident's breaking
commit sat on `doreen/import` for some time before the next tier-two CI
run caught it), not by "nothing gated the merge."

Closing the tier-one gap still needs a design that does not encode a
specific branch name into committed workflow trigger config, which is
outside this task's scope to decide unilaterally.

### Recommendation

No further CI trigger change is recommended by this document at this
time — the previously recommended fix conflicted with the policy above
and has been withdrawn. Keep **(a)** (already landed) as cheap,
always-on, complementary defense in depth: it makes toolchain drift
visible locally the moment it happens, for anyone who happens to check
warnings before pushing. Whether and how to close the tier-one
(`doreen/import`) detection-latency gap described above is left open for
a future proposal that does not require committing a branch name into
workflow trigger config.

## CI Audit Gate Design: Blocking + Non-Blocking Split (Option 5)

### Background

That change found 5 dev-only high-severity CVEs (`axios`, `brace-expansion`,
`linkify-it`, `shell-quote`, `systeminformation`) that had accumulated
undetected, because the existing `audit` job's `npm audit --omit=dev
--audit-level=high` step is scoped to production dependencies only by
design (see the job's own inline comment in `ci.yml`), and dev-only
findings were otherwise expected to be caught by Dependabot — a mechanism
that, at the time, was itself broken for a different reason (see
an internal working branch tracking that fix). The result: a
class of finding with no active detection path.

Several options were weighed (blocking the existing gate on all scopes,
lowering the blocking threshold to `moderate`, a time-boxed exception
list, status quo). The adopted design **keeps the existing blocking gate
unchanged** and adds a **non-blocking, full-scope companion job** instead
of widening what blocks merge. Full reasoning and the options considered
are captured in the corresponding design record for this task.

### The design

1. **Blocking gate (`audit` job) — unchanged.**
   `npm audit --omit=dev --audit-level=high` continues to gate merges on
   production-dependency high/critical CVEs only. Dev-only findings never
   block a PR under this job, by design — dev tooling ships to CI runners
   and contributor machines, not to the deployed product.

2. **Non-blocking gate (`audit-full-scope` job) — new, added as part of that change.**
   Runs `npm audit --audit-level=high` (no `--omit=dev`,
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
   just "should" by convention) is captured in the corresponding
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
   visibility gap that caused Incident 3 in the first place, so that review
   step is treated as a load-bearing part of this design, not an
   afterthought, even though its specifics live outside this repository.

---

## Related Documents

- `docs/knowledge/submodule-pointer-bump-policy.md` — analogous policy
  for submodule pointer bump tasks
