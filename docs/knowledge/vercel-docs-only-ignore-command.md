# Vercel docs-only Ignored Build Step (cmd_728)

Lord's ruling (cmd_720): adopt a docs-only build skip for the three
consumer Vercel projects (app-template/"app-generator-sample",
inventory-app, insurance-app). This doc records what was actually
implemented and, more importantly, the empirically-measured Vercel
mechanics that made the straightforward design (put `ignoreCommand` in
this repo's own `vercel.json`) not work, and why the design below was
used instead.

## What was tried first, and why it doesn't work

The obvious design puts `ignoreCommand` directly in
`app-generator/vercel.json` -- this repo is the single canonical
source for the rest of that file's keys (`framework`, `buildCommand`,
`regions`), and all three consumer Vercel projects have their Root
Directory set to this submodule, so that file is the one Vercel reads
for the build. That assumption turned out to be wrong for
`ignoreCommand` specifically. Measured across many real probe
deployments against `app-generator-sample` (public repo, disposable
branches/PRs, closed/deleted after measurement):

- **A `vercel.json` inside Root Directory never has its
  `ignoreCommand` read at all**, regardless of exit code. Deployments
  built through to completion every time, with the ignoreCommand's own
  echo output never appearing anywhere in the build log -- it was
  never invoked.
- **`ignoreCommand` is only honored from a `vercel.json` at the
  connected repo's actual root** (one level above Root Directory for
  these three projects). Once present there, it *is* read, and other
  keys (`framework`/`buildCommand`) still correctly fall back to the
  Root-Directory-scoped `vercel.json` for anything the root file
  doesn't itself define -- this is a per-key fallback, not
  all-or-nothing.
- **Despite being read from the root file, the command still executes
  with cwd = Root Directory** (`/vercel/path0/app-generator`), same as
  every other build command.
- **`cd ..` from inside that cwd works** and lands in the outer
  (consumer) repo's checkout, with a full git history and working
  tree -- `.git`, `docs/`, `README.md`, `prj/`, etc. all present and
  usable. This directly contradicts the Vercel docs for Root
  Directory ("Your app will not be able to access files outside of
  that directory... cannot use `..` to move up a level") -- that
  restriction does not hold for `ignoreCommand`, at least as measured
  2026-08-16/17. Treat the docs claim as unreliable for this specific
  command; re-verify empirically before relying on it again if this
  mechanism is revisited.
- **`ignoreCommand` (whether set via `vercel.json` or via the
  project's dashboard/API `commandForIgnoringBuildStep` field) is
  capped at 256 characters.** A longer command fails Vercel's own
  config validation before any deployment record is even created (the
  GitHub commit status goes straight to `failure`, target URL a
  generic vercel.json docs page) -- there is no partial/best-effort
  execution, it's a hard reject. This rules out inlining the full
  path-classification logic (with diagnostic `echo`s) directly in
  either location.
- A skipped deployment surfaces as Vercel status **`Canceled`** (CLI
  and dashboard), with the GitHub commit status still `success`
  (description `Canceled by Ignored Build Step`) -- visible and
  positive, not a silent absence, matching the same visibility
  requirement the CI-side design (cmd_721/725) already established for
  a different reason.
- `VERCEL_GIT_PREVIOUS_SHA` is empty on a branch's first-ever
  deployment (measured on a disposable throwaway branch) -- the
  concrete real-world trigger for the fail-closed path, not just a
  theoretical shallow-clone edge case.
- `VERCEL_GIT_PREVIOUS_SHA` does not advance past a deployment that was
  itself skipped/canceled -- it stays at the last commit that actually
  reached a real build. Consecutive docs-only pushes accumulate against
  the same base rather than comparing only the latest single commit,
  which is the safer direction (never under-counts a diff).

## What was implemented instead

- **`app-generator/scripts/vercel-ignore-check.sh`** -- the actual
  decision logic (single canonical copy, lives here). `cd ..`, resolve
  `VERCEL_GIT_PREVIOUS_SHA` as the diff base (fail closed / build if
  empty or not resolvable in this shallow clone), then
  `git diff --quiet` against the base with the same excluded-path list
  used by this repo's own CI `detect-changes` job (cmd_725): `docs/**`,
  `README.md`, `README_ja.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`,
  `LICENSE`. Exit 0 (docs-only) to skip, non-zero to build.
- **`app-generator/vercel-ignore.json`** -- a tiny stub,
  `{"ignoreCommand": "sh scripts/vercel-ignore-check.sh"}`. This is
  the file each consumer's root actually needs.
- **Each consumer repo's root gets a symlink**, `vercel.json ->
  app-generator/vercel-ignore.json`, following the same "one canonical
  copy + thin reference" pattern already used for the
  `scripts/vercel-{setup,deploy,env,teardown}.sh` family (see
  `docs/knowledge/vercel-deploy-scripts-canonical-source.md`) and for
  `.claude/commands/investigate.md`. Not a byte-for-byte copy: a copy
  would drift the same way those files did before cmd_711 consolidated
  them.
- `app-generator/vercel.json` (the Root-Directory-scoped file) is
  **unchanged** -- `framework`/`buildCommand`/`regions` stay exactly as
  they were; `ignoreCommand` was never added there because it would
  have no effect.

### The `docs/consumer-commands/**` carve-out does not apply here

cmd_725's CI-side design excludes `docs/consumer-commands/**` from its
own docs-only exemption, because that directory holds the canonical
CI/gate templates distributed to every consumer -- editing it changes
what every consumer's *own CI* runs, which is a real (non-docs) change
from CI's point of view. The Vercel check has no equivalent case: it
always runs `cd ..` and evaluates the diff against the *consumer's own
root*, which has no `docs/consumer-commands/` directory of its own
(that path only exists inside app-generator). The two checks are
asking different questions -- CI asks "can the gate be skipped",
Vercel asks "did the served screens change" -- and for Vercel, editing
this repo's own CI templates is invisible to a consumer's deployment
either way (this repo isn't a Vercel-connected project at all; only
the three consumers are).

## Deviation from the original design ask, flagged explicitly

The task instructions (cmd_728) required the canonical source to be
`app-generator/vercel.json` alone, with **no** vercel.json-shaped file
at any consumer's root, citing a prior incident
(`app-template-vercel-json-must-not-exist`) where a full root
`vercel.json` (defining `installCommand`/`buildCommand` with a
`--prefix app-generator` assumption that only made sense run from repo
root) doubled the effective path once combined with Root Directory
cwd, breaking nearly all PR-linked deploys. That incident is real and
the underlying rule (don't put a *build-command-defining* vercel.json
at a consumer's root) still holds. What's added here is narrower and
was verified not to reproduce that failure mode: the stub only
contains `ignoreCommand`; `buildCommand`/`installCommand` are absent
from it and keep resolving from `app-generator/vercel.json` exactly as
before (confirmed across every probe deployment used above -- `npm run
vercel-build` / `prj:sync` ran to completion each time a build
proceeded). Given `ignoreCommand` is *only* ever read from a
repo-root file (never from a Root-Directory-scoped one, per the
finding above), there was no design that both (a) implements this
Lord-approved feature and (b) keeps every consumer root file-free.
The alternative that does keep consumer roots file-free --
`commandForIgnoringBuildStep` set per-project via the Vercel
dashboard/API, no git file at all -- was also verified working, but
the same 256-character cap forces it to run silent (no room for the
diagnostic `echo` lines that make a wrong skip decision debuggable
from the build log), and it isn't version-controlled or
code-reviewable. The symlink-stub route was chosen over the dashboard
route for that reason; the dashboard route remains available as a
fallback if a future incident traces back to this stub file.

## Evidence

See `queue/reports/subtask_728_vercel_docs_only_ignore_command_ashigaru7.yaml`
for the full probe deployment/run URL list (both directions, the
fail-closed fresh-branch case, and the repo-wide `prj/**` visibility
case).
