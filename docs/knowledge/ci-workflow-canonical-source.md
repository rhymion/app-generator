# Consumer `.github/workflows/ci.yml` — canonical source

`docs/consumer-commands/ci.yml` in this repo is the canonical, shared
content of `.github/workflows/ci.yml` used by every consumer repo
generated from this generator (app-template / inventory-app /
insurance-app). This repo's own `.github/workflows/ci.yml` is a
**different, unrelated** workflow (it tests this generator's own
`code_generator/` and root Node app — lint/unit-tests/audit/e2e-tests/
pytest jobs, triggered on `[master, main]` only) and is not affected by
this file.

Before this canonicalization, the three consumer repos each carried
their own independently-edited copy of the single-job `E2E Tests`
workflow, with app-generator holding no copy of its own. This is the
same "three consumers wanting the same thing is itself the signal to
canonicalize, even when the generator had no prior copy of its own"
pattern already used for the Vercel deploy scripts (see
`docs/knowledge/vercel-deploy-scripts-canonical-source.md`).

## Why a plain copy, not a symlink

The `.claude/commands/*.md` files and `scripts/vercel-*.sh` use a
symlink from the consumer into their own `app-generator/` submodule
checkout — the file is only ever read *after* the repository has
already been checked out by a running job or agent, so the symlink
target is guaranteed to exist by the time anything opens it.

`.github/workflows/ci.yml` is different: GitHub Actions decides whether
a `push`/`pull_request` event triggers a run — and what the workflow
even contains — by resolving `.github/workflows/*.yml` from the target
repository's own tree via its own backend, before any runner checks
anything out. Whether a symlink there is followed for that resolution
step is unverified and not worth risking against silently breaking CI
triggering entirely. Consumers therefore carry a **plain copy** with a
header comment pointing back to this file, and updates are distributed
by copying the changed content into each consumer, same as any
copy-distributed (not reference-form) file.

## Distribution status (2026-08-16)

The `concurrency:` block (group by `${{ github.workflow }}-${{
github.ref }}`, `cancel-in-progress: true`) was added here and
distributed to app-template (public). Verified on app-template: a
push that supersedes an already-running `pull_request` run for the
same PR now gets that prior run auto-cancelled by GitHub within
seconds, instead of running to completion uncancelled.

inventory-app and insurance-app (both private) have **not** been
updated with this copy yet — left as a follow-up so as not to trigger
additional Actions runs against those repos' limited/newly-enabled
allotments as a side effect of a documentation task. The change itself
is a two-line addition; copying it in is mechanical once picked up.

## Docs-only E2E skip

Added a `detect-changes` job that classifies the diff by path and a
`needs:`+`if:` gate on `e2e-tests`, instead of a top-level
`paths-ignore:` trigger filter. Two reasons `paths-ignore:` was
rejected even though it is the more obvious/shorter option:

1. **Visibility.** When a `paths-ignore:`-filtered event doesn't match,
   the workflow never triggers at all — no check run of any kind is
   created for that commit/PR. That is indistinguishable, from the PR
   Checks list, from the check never having existed. A `needs:`+`if:`
   gate still runs the (cheap, few-second) `detect-changes` job and
   shows `E2E Tests` in the Checks list with a "Skipped" badge — the
   skip is a visible, positive signal, not an absence.
2. **Required-status-check safety (future-proofing).** None of the
   consumer repos currently has branch protection configured (verified
   directly against each repo's branch-protection API, 404 on every
   branch), so this isn't live today. But `paths-ignore:` is documented
   by GitHub to leave a required status check permanently "Expected —
   Waiting for status to be reported" for path-filtered-out commits,
   because the check run that branch protection is waiting for is
   never created. If branch protection is ever added later, a
   `paths-ignore:` design would silently turn into a permanent merge
   blocker on docs-only PRs. `needs:`+`if:` has no such trap: a job
   that ran and was skipped still reports a (non-blocking) conclusion.

**Classification is by path only, computed by the workflow itself**
(`git diff <base> HEAD -- . ':(exclude)...'`), never by commit message
or a human "this is docs-only" claim — a condition the workflow itself
cannot see is a hole, not an exemption. Base commit:
`github.event.pull_request.base.sha` for `pull_request` events,
`github.event.before` for `push` events; if neither resolves to a
commit present in history (new branch, force-push edge case), the job
fails closed to `docs_only=false` (full suite runs) rather than
guessing.

**Excluded (treated as docs-only, safe to skip) paths**, matched
against each consumer repo's real top-level layout:
`docs/**`, `README.md`, `README_ja.md`, `CHANGELOG.md`, `AGENTS.md`,
`CLAUDE.md`, `LICENSE`.

**Deliberately NOT included** (still trigger the full suite even
though they look docs-adjacent): `.claude/**`, `.codex/**` (agent
tooling — kept conservative rather than asserting they can never
affect a generate-code run), `spec/**` (inventory-app/insurance-app
only — ER-diagram source, not `.md`; a plausible future addition, not
decided here), `.github/**` (workflow files themselves — must never be
skippable, including edits to this very `ci.yml`), `app-generator`
(the submodule pointer — a pointer bump is a real code change),
`.gitmodules`, `package.json`, `.env*`, `prj/**`, `scripts/**`.

**Before/after contrast, measured on app-template (public, disposable
probe PRs closed after measurement)**:
- Before (pre-existing `.github/workflows/ci.yml`, no path gate): a
  docs-only diff (`README.md` only) still ran the full `E2E Tests` job
  end-to-end.
- After (this canonical `ci.yml` copied in): the same shape of
  docs-only diff shows `E2E Tests` as **Skipped** in the Checks list
  (job conclusion `skipped`, `detect-changes` job runs and completes in
  seconds). A mixed diff (touches `README.md` **and** a non-excluded
  path in the same commit) still runs `E2E Tests` to completion,
  unskipped.

inventory-app and insurance-app (both private) have **not** received
this copy yet, same reasoning as the concurrency change above — left
as a follow-up so as not to burn their limited/newly-enabled Actions
allotment as a side effect of this task.
