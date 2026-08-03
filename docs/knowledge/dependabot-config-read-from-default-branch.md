# Dependabot reads `.github/dependabot.yml` from the default branch only

## Problem

Dependabot version-update PRs kept landing against `main` even after this
repo's real merge target became `develop` and `.github/dependabot.yml` was
updated with `target-branch: develop` (PR #238, merged 2026-08-02T08:54Z).

The `target-branch` option only changes where Dependabot **opens PRs**. It
does not change where Dependabot **reads its own configuration file from**.
Dependabot always fetches `.github/dependabot.yml` from the repository's
GitHub-configured default branch — a repo setting (Settings → General →
Default branch), independent of the `dependabot.yml` content itself. A copy
of `.github/dependabot.yml` on any other branch (including one with
`target-branch: develop`) is inert: Dependabot never opens or evaluates it.

This repo's default branch is `main`. So the `target-branch: develop`
setting added to `develop`'s copy in PR #238 had zero effect, because
Dependabot was still reading `main`'s copy (which had no `target-branch`
key at all).

## Empirical proof

PR #246 (`build(deps): bump the actions-all group with 3 updates`) was
opened against `main` on 2026-08-02T23:04Z — about 14 hours *after* PR
#238 merged `target-branch: develop` into `develop`. If Dependabot read
config from `develop`, #246 would have targeted `develop`. It targeted
`main` instead, because Dependabot never reads `develop`'s copy.

## Fix

Add the identical `target-branch: develop` setting to **`main`'s** copy of
`.github/dependabot.yml` (PR #248) — the copy Dependabot actually
consumes. `develop`'s copy (PR #249) keeps `target-branch: develop` too
(no functional change there), with its header comment corrected to say
it's not the one being read, and to point at `main`'s copy as
authoritative.

**Keep both copies in sync going forward.** Any future edit to
`.github/dependabot.yml`'s `updates:` section must land on both `main` and
`develop`, or the two branches' Dependabot behavior will silently diverge
again.

## Known limitation this does not fix

Per GitHub's documented `target-branch` semantics, this setting applies to
**version updates only**. Security-update PRs (triggered by vulnerability
alerts) are always raised against the default branch regardless of
`target-branch`. As long as the default branch stays `main`, a
security-advisory PR will still land on `main` and needs manual
retargeting/porting to `develop`. Changing the repository's actual default
branch setting to `develop` would remove this asymmetry but is a
repo-administration decision, not a `dependabot.yml` change — out of scope
here.

## Verification

Dependabot runs weekly (Monday 08:00 Asia/Tokyo). This week's run already
fired before this fix merged (that's how PR #246 was created, at
2026-08-02T23:04Z UTC = 2026-08-03T08:04 JST). There is no `gh` CLI or
public REST/GraphQL API to force an immediate re-check — the only manual
trigger is the GitHub UI (Insights → Dependency graph → Dependabot →
"Check for updates"). Editing `.github/dependabot.yml` itself is also
documented to trigger an immediate check, so merging PR #248 may produce
a `develop`-targeted PR before the next scheduled Monday run; if not, the
next scheduled run is 2026-08-10T08:00 Asia/Tokyo.
