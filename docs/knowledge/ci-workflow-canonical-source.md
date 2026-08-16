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
