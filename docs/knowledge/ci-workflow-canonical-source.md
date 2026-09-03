# Consumer `.github/workflows/ci.yml` — canonical source

`docs/consumer-commands/ci.yml` in this repo is the canonical, shared
content of `.github/workflows/ci.yml` used by every consumer repo
generated from this generator (app-template / inventory-app /
insurance-app). This repo's own `.github/workflows/ci.yml` is a
**different, unrelated** workflow (it tests this generator's own
`code_generator/` and root Node app — lint/unit-tests/audit/e2e-tests/
pytest jobs, triggered on `[master, main, develop]`) — the job content
of the two files remains unrelated. As of a later change, though, this repo's
own `detect-changes` job's path classification does treat this
canonical file specially (see "Docs-only E2E skip — app-generator's own
CI" below): editing it must never be classified docs-only in
*this* repo's own CI, even though it is not itself part of this repo's
`e2e-tests` build.

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
`docs/**`, `spec/**`, top-level `*.md` (via `:(exclude,glob)*.md`, see
"Docs-only E2E skip — folder and extension additions" below),
`README.md`, `README_ja.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`,
`LICENSE`.

**Deliberately NOT included** (still trigger the full suite even
though they look docs-adjacent): `.claude/**`, `.codex/**` (agent
tooling — kept conservative rather than asserting they can never
affect a generate-code run; this also covers nested `.md` files under
those trees such as `.claude/commands/*.md` and
`.claude/skills/**/SKILL.md` — see "folder and extension additions"
below for why a recursive `*.md` rule was rejected specifically
because it would have swept those in), `.github/**` (workflow files
themselves — must never be skippable, including edits to this very
`ci.yml`), `app-generator` (the submodule pointer — a pointer bump is
a real code change), `.gitmodules`, `package.json`, `.env*`, `prj/**`
(including nested `.md` files under it, e.g.
`prj/docs/manual-tests/fk-reference-rules.md` found on insurance-app —
`prj/**` stays conservative for the same generate-code-input reason as
`.claude/**`/`.codex/**`; carving out a docs-only subfolder there would
need the same kind of pre-exclusion carve-out job used for
`docs/consumer-commands/**` in this repo's own CI below, which is a
real design addition, not attempted here), `scripts/**`.

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

inventory-app and insurance-app (both private) have since received
this copy (each carries its own `ci: sync ci.yml with app-generator
canonical source (concurrency, detect-changes, drift check)` commit;
correcting the "not received yet" note above, now stale).

## Docs-only E2E skip — folder and extension additions

Two additions to the exclude list above, both triggered by a real
incident: a doc-only PR touching only
`spec/inventory-implementation-gap-ledger.md` (a one-line ledger
entry) still ran the full `E2E Tests` job end-to-end on a private
repo, burning Actions minutes against a limited allotment for a change
that could not possibly affect generated output.

**`spec/**` (folder).** Present on inventory-app and insurance-app
(ER-diagram/gap-ledger/state-machine prose: `.md` and `.mermaid`
files), absent on app-template. Confirmed safe by scanning: nothing
under `code_generator/`, `.claude/commands/*.md`, or `.codex/prompts/*.md`
in this repo reads a consumer's `spec/**` as generate-code input, and
no consumer app route imports or renders anything from `spec/**` at
build or runtime (checked for `readFileSync`/import references to
`.md` paths in `app/`, `lib/`, `components/`, `scripts/` across all
three consumers — none found). It was considered and deliberately left
out during the original docs-only-skip design (see the "Deliberately
NOT included" list above at the time) specifically because it hadn't
yet been proven safe; this PR is that proof.

**Top-level `*.md` (extension), via `:(exclude,glob)*.md`.** A bare
`*.md`/`**/*.md` pathspec was rejected — verified empirically against
a scratch repo — because git's default (non-`:(glob)`) pathspec
wildcard matching does **not** set `FNM_PATHNAME`, so a bare `*`
crosses `/` and a bare `*.md` pattern excludes `.md` files at any
depth, not just the top level. That would have silently also exempted
`.claude/commands/*.md` (this repo's own Gate SoT — see CLAUDE.md
"Gate SoT Rule" — a doc a consumer's own generator tasks read to know
which commands the Completion gate runs, but not itself consumed by
this `ci.yml`'s fixed npm scripts, so exempting it from the E2E gate
specifically is plausibly safe on its own; still not adopted here,
see below), `.codex/prompts/*.md`, `.claude/skills/**/SKILL.md` (agent
tooling, kept conservative for the same "not proven never to affect
generate-code" reason as `.claude/**`/`.codex/**` above), and
`prj/docs/manual-tests/fk-reference-rules.md` (found on insurance-app,
nested under `prj/**`, which stays conservative for the same reason).
Git pathspec exclude patterns have no re-include operator (already
noted in the "Docs-only E2E skip — app-generator's own CI" section
below for the same reason), so there is no way to write "exclude all
`.md` except these" as a single pathspec — only a scope narrow enough
to exclude nothing else works without a dedicated carve-out job. Using
`:(exclude,glob)*.md` (glob magic sets `FNM_PATHNAME`, so `*` does not
cross `/`) restricts the match to files directly at the consumer
repo's root — verified in the same scratch repo: a root `README.md`
edit was excluded, a nested `.claude/commands/update-code.md` edit in
the same diff was not. This covers the already-named root files
(`README.md`, `README_ja.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`
— left in place alongside the glob rather than removed, since the glob
already subsumes them and removing them would be an unrelated,
unrequested simplification) and future-proofs against a new top-level
`.md` file being added later without another `ci.yml` edit, without
touching anything nested.

**Considered and not adopted (fail-closed — no proof of safety, not a
folder the incident actually hit):** `prj/docs/manual-tests/*.md`
(insurance-app) — a docs subfolder nested inside `prj/**`, which is
kept conservative as generate-code input; carving just this subfolder
out would need the same kind of pre-exclusion carve-out job that
`docs/consumer-commands/**` uses in this repo's own CI (see below),
which is a real design addition out of scope here. `.claude/commands/*.md`
— plausibly safe on its own reasoning (a consumer's Completion-gate
commands are read by an agent, not executed by this fixed-script
`ci.yml`, so editing their prose can't change what the E2E gate runs),
but a blanket glob can't reach it without also reaching
`.codex/prompts/*.md` and `.claude/skills/**/SKILL.md`, which have no
equivalent safety argument yet — left for a future, separately-scoped
change if ever pursued.

**Vercel `ignoreCommand` (`scripts/vercel-ignore-check.sh`) — measured,
not implemented.** All three consumers wire it identically via
`vercel.json`'s `"ignoreCommand": "sh scripts/vercel-ignore-check.sh"`.
Its exclude-path list is a deliberate mirror of this job's list (see
that script's own header comment), so the same `spec/**` and
`:(exclude,glob)*.md` additions would be logically consistent there —
skipping an unnecessary Vercel preview build for the same shape of
doc-only diff. Not implemented here: Actions consumption (this task's
actual trigger — a private-repo minutes allotment) and Vercel
consumption are billed and governed separately, and this task's
mandate was measurement only for the Vercel side.

## Docs-only E2E skip — app-generator's own CI

Separate from the consumer-side gate documented above: this repo's own
`.github/workflows/ci.yml` gained the same `concurrency` +
`detect-changes`/`needs:`+`if:` shape, gating only its own
`e2e-tests` job — `lint`/`unit-tests`/`audit`/`audit-full-scope`/
`pytest`/`mention-gate-fixture`/`decimal-gate-fixture`/
`oto-mandatory-gate-fixture` always run regardless of `docs_only`,
both because `e2e-tests` is the dominant cost here too (~57-60 min)
and as a safety net against a path-judgment mistake in this
job.

**This repo's exempt (docs-only) path list differs from the consumer
list above in two ways:**

1. **`docs/consumer-commands/**` is carved out — checked and excluded
   from the exemption *before* the general `docs/**` exclusion, not
   folded into it.** `docs/` in general is documentation about this
   repo (safe to skip), but `docs/consumer-commands/` holds the
   canonical CI/gate source distributed to every consumer's own
   `.github/workflows/ci.yml` and `.claude/commands/{generate-schema,
   update-code,update-component}.md` — editing it is a change to what
   every consumer runs, not prose about this repo, so a PR touching it
   must never be skipped here. This has to be a separate `git diff
   --name-only ... -- docs/consumer-commands` check run *before* the
   general exclusion, not a pathspec combining `':(exclude)docs/**'`
   with a later positive `docs/consumer-commands/**` entry — git
   pathspec exclude magic has no re-include operator; once a path
   matches an `:(exclude)` pattern it is removed from the match set
   regardless of what other (non-exclude) pathspecs are also given.
   Verified empirically in a scratch repo before relying on it.
2. **`AGENTS.md` is dropped from the exemption list** (present in the
   consumer list). Unlike consumers, this repo's `AGENTS.md` carries
   this repo's own gate definitions (CLAUDE.md "Gate SoT Rule" — the
   `## Completion gate` section `.claude/commands/*.md` files point
   to). `.claude/commands/*.md` was never in either list to begin
   with, for the same reason — no code change was needed to exclude
   it, only this note that it stays excluded on purpose.

**Verification.** A same-shape local proof, run against a
scratch repo mirroring this layout (`docs/knowledge/`,
`docs/consumer-commands/ci.yml`, `AGENTS.md`, `.claude/commands/`,
`.github/workflows/ci.yml`, run with both this job's actual script body
and a without-the-carve-out counterfactual):

| diff touches only… | with carve-out | without carve-out (counterfactual) |
|---|---|---|
| `docs/consumer-commands/ci.yml` | `docs_only=false` (correct — carve-out fires) | `docs_only=true` (**wrong** — the failure mode the carve-out prevents) |
| `docs/knowledge/foo.md` | `docs_only=true` | `docs_only=true` |
| `AGENTS.md` | `docs_only=false` | `docs_only=false` |
| `.claude/commands/update-generator.md` | `docs_only=false` | `docs_only=false` |
| `.github/workflows/ci.yml` itself | `docs_only=false` | `docs_only=false` |
| no usable base commit (new branch) | `docs_only=false` (fail-closed) | (same check, untouched) |

Live in real GitHub Actions: PR
[#364](https://github.com/rhymion/app-generator/pull/364) (this task's
own implementation commit, which itself touches `.github/workflows/
ci.yml` and is therefore correctly classified non-docs-only) — all 9
pre-existing jobs plus the new `detect-changes` job ran and passed,
`e2e-tests` scheduled (not skipped). A live PR isolating *only* a
canonical-file edit against this job (rather than the local proof
above) needs `docs/consumer-commands/**`'s carve-out to already be on
`develop`, because `pull_request` only triggers for
`branches: [master, main, develop]` — a PR against a feature branch
never runs this workflow at all, so that specific isolation has to
wait until after this PR merges.

## Drift check

The distribution measured above already proved the risk this section
answers: the first copy distributed (app-template) was **not**
byte-identical to the canonical body — one step's `name:` field carried
an internal-tracking suffix the canonical source doesn't have, and
several step comments had been reworded to reference internal task
numbers. Nobody caught it at distribution time because nothing checked.
"Copy the result verbatim" (the instruction at the top of this file) is
unenforceable as long as compliance is a human claim — same shape of
gap as noted elsewhere ("a condition the machine doesn't see is a hole, not an
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

**Bootstrapping edge case (found live, verifying against app-template's
actual CI run)**: a consumer's `app-generator` submodule pointer can be
pinned to a commit *older than the one that introduced
`docs/consumer-commands/ci.yml` in the first place* — app-template's
pointer was, at the time this job was first added. In that state the
extraction step finds no canonical file to compare against at all. This
is not drift (there is nothing to have drifted from yet) and must not
fail the build — the job treats a missing canonical file as a `::notice`
and exits 0; it starts actually comparing automatically the next time
the consumer's submodule pointer is bumped past the commit that added
the canonical file. Bumping the pointer sooner is not required by this
job and is a separate, already-tracked concern (a pointer bump is
excluded from the docs-only skip above precisely because it's a real
code change, reviewed on its own schedule — see the "submodule pointer
bump becomes regression" pattern in this generator's own change
history).

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

**Internal cmd-number annotations (e.g. task-tracking references
found in the first distributed copy) — not a vocabulary violation**:
checked against `scripts/vocab_patterns.sh` (this control repo's SoT
for internal-vocabulary leaks into public repos), which has no pattern
matching a bare `cmd_NNN` token in file *content* — only a cmd number
immediately fused to a round-label kanji character is a content-leak
pattern there, and a separate filename-only pattern for `cmd_NNN`
matches only a file's *path*, never its body. A bare `cmd_NNN`-shaped token sitting
inside a YAML comment matches neither. This is consistent with public
commit titles in this repo's own history already carrying the same
shape (`feat(scripts/cmd_NNN): ...`) without being flagged. So: the
reason those annotations must not survive in a consumer's copy is
**only** "the canonical source doesn't have them and the file is a
verbatim copy by design" (enforced by the full-body match above) — not
an internal-vocabulary rule. A future distribution or review of this
file should not cite vocabulary-leak policy as additional justification
for stripping them; the drift check alone is sufficient and correctly
scoped.
