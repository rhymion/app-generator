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

## Drift check (cmd_723)

The distribution measured above already proved the risk this section
answers: the first copy distributed (app-template) was **not**
byte-identical to the canonical body — one step's `name:` field carried
an internal-tracking suffix the canonical source doesn't have, and
several step comments had been reworded to reference internal task
numbers. Nobody caught it at distribution time because nothing checked.
"Copy the result verbatim" (the instruction at the top of this file) is
unenforceable as long as compliance is a human claim — same shape of
gap as cmd_498 ("a condition the machine doesn't see is a hole, not an
exemption").

**Mechanism**: a `verify-canonical-ci` job, now part of the canonical
body itself (so it is distributed to every consumer along with
everything else). It checks out the consumer repo with
`submodules: recursive` (already required by `e2e-tests` below, so no
new checkout cost), extracts this file's own body from `.github/
workflows/ci.yml` starting at the line `name: CI`, extracts the same
range from `app-generator/docs/consumer-commands/ci.yml` in the
just-checked-out submodule, and fails the job with a `diff -u` if they
differ. No dependency on `detect-changes` — it runs on every push/PR
unconditionally, independent of path classification, because the thing
it guards against (a consumer's copy silently diverging from the
version of the canonical file its own submodule pointer already pins)
is not a "was this push docs-only" question.

**Placement — consumer side only, not app-generator's own CI**: the
check could in principle also run in app-generator's own CI, comparing
this file against each consumer's live `.github/workflows/ci.yml`. That
was rejected: app-generator's own CI has no checkout of the three
consumer repos (inventory-app and insurance-app are private), so a
generator-side check would need cross-repo read tokens provisioned
solely to lint a documentation-drift condition — a real credential-
scope increase for a low-severity check, and asymmetric with how every
other canonicalized file in this repo already works (`.claude/
commands/*.md` and `scripts/vercel-*.sh` are read by the consumer via
its own submodule checkout, never fetched by app-generator reaching
outward). The consumer-side placement instead falls out for free: the
`e2e-tests` job below already proves a consumer's CI run has the
canonical source available locally (the submodule checkout), so the
check requires zero new access and lives entirely inside the file
being distributed — verification travels with the artifact it verifies.
No "both" option was pursued for the same reason — a generator-side
half would either duplicate this exact check against a token-gated
fetch (redundant with the consumer-side one for public app-template,
useless for the two private consumers unless a token is provisioned) or
check nothing meaningful on its own.

**Scope — full-body match, not structure-only**: the diff compares the
*entire* body (from `name: CI` to end of file, comments included), not
just the executable structure (`name:`/`on:`/`jobs:` keys with comments
stripped). Reasons:

1. The canonical file's own header already states the contract in
   these exact terms — "copy the result verbatim... from `name: CI`
   onward" — full-body match enforces that literal, pre-existing
   instruction rather than inventing a new, narrower one.
2. The actual drift instance this task started from (a step's `name:`
   field carrying an appended tracking suffix) sits in ordinary
   workflow structure, not inside a `#`-comment — a scope that only
   diffed structure-with-comments-stripped could plausibly still miss
   it depending on exactly how "structural" is defined for a step
   `name:` field. Full-body match sidesteps having to define that
   boundary at all.
3. This file is explicitly framed as a plain, non-customizable copy
   (unlike, say, `generate-schema.md`'s KEEP LOCAL sections in
   `consumer-commands-canonical-source.md`, which exist precisely
   because consumers legitimately hold measured, consumer-specific
   facts). There is no legitimate reason for a consumer to carry its
   own supplementary comment inside this file, so a stricter check
   costs nothing in practice.
4. Full-text diff is a two-line `sed`+`diff`; a structure-only,
   comment-blind comparison would need a YAML-aware normalization step
   and a definition of which fields are "structural" — more moving
   parts, and the extra judgment call is exactly the kind of thing this
   task exists to take out of human hands, not re-introduce as an
   implementation detail.

The earlier partial canonicalization of `generate-schema.md` (see
`docs/knowledge/consumer-commands-canonical-source.md`'s KEEP LOCAL
sections) was considered as a precedent but does not transfer: that
file mixes genuinely shared procedure with genuinely consumer-specific
measured facts, so partial canonicalization preserves real information.
`ci.yml` has no consumer-specific facts in it at all — every byte of
the body is meant to be identical across consumers by design — so there
is nothing a partial/structural check would be protecting that a full
match doesn't already cover for free.

**Internal cmd-number annotations (e.g. `cmd_527`, `cmd_528`, `cmd_705`
found in the first distributed copy) — not a vocabulary violation**:
checked against `scripts/vocab_patterns.sh` (this control repo's SoT
for internal-vocabulary leaks into public repos), which has no pattern
matching a bare `cmd_NNN` token in file *content* — only a cmd number
immediately fused to a round-label kanji character is a content-leak
pattern there, and a separate filename-only pattern for `cmd_NNN`
matches only a file's *path*, never its body. A bare `cmd_527` sitting
inside a YAML comment matches neither. This is consistent with public
commit titles in this repo's own history already carrying the same
shape (`feat(scripts/cmd711): ...`) without being flagged. So: the
reason those annotations must not survive in a consumer's copy is
**only** "the canonical source doesn't have them and the file is a
verbatim copy by design" (enforced by the full-body match above) — not
an internal-vocabulary rule. A future distribution or review of this
file should not cite vocabulary-leak policy as additional justification
for stripping them; the drift check alone is sufficient and correctly
scoped.
