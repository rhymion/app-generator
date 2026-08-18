# Lint warning ceiling: ratchet, not a fixed number

**Rule**: `npm run lint` (`eslint --max-warnings <N>`) enforces a ceiling on
`@typescript-eslint/no-unused-vars` and friends so that a warning nobody
reads never again hides a real one (a prior triage found 216 warnings had
accumulated behind a config gap; one `no-unused-vars` finding among them
was a genuine dead branch). `N` is a **ratchet, not a constant**: it only
ever moves down (as further warnings get fixed) or is bumped up with an
explicit, reviewed reason (a new lint rule enabled, a large refactor
landing that legitimately needs a few cycles to clean up). It is never
silently raised just because a PR would otherwise go red.

## Current value and why

Measured on `develop` tip `c10b1b1a` (2026-08-04): `npm run lint` reports
**15 warnings, 0 errors** (7 `no-unused-expressions`, 5 `no-img-element`, 3
`no-unused-vars`). `N=20` — a small (5-warning) headroom above the measured
count, not the exact count. Zero headroom (`N=15`) would turn any single
incidental warning into an immediate red CI run on an unrelated PR, which
is more noise than this gate should generate; unbounded headroom (e.g. a
value sized for a since-stale, much larger historical baseline) defeats
the point of a ceiling. 5 is enough to absorb one incidental warning
without masking a second.

**Note the baseline moved**: an earlier triage (PR #244) landed warnings
at 74. By the time this gate was added, unrelated merges had dropped the
count further to 15 without anyone deliberately chasing lint count —
don't assume a warning count quoted in an old report is still current;
remeasure with `npm run lint` before picking `N`.

**Correction (2026-08-07)**: the "15" above was always the
*pre-generate-code* count — the only state CI's `Lint` job ever checks
(`npm ci && npm run lint`, no `generate-code` step). Several
`.claude/commands/*.md` Completion gates historically ran `npm run lint`
*after* `test:e2e:build` (which runs `generate-code`), which lints a much
larger, uncalibrated file set — measured at 93 warnings on this exact same
commit (`c10b1b1a`), not 15. That divergence was mistaken for a 15→93
regression between commits until re-measured; there was none. The gate
docs now run `npm run lint` first, before any generate-code step, so `N=20`
is guaranteed to mean what this doc says. See
`lint-gate-must-match-ci-precondition.md` for the full investigation.

## Operating the ratchet

- **Lowering `N`**: whoever's PR reduces the actual warning count below
  `N - 5` should lower `N` to `(new count) + 5` in the same PR. This is not
  mandatory on every PR — only when the gap between actual and ceiling has
  grown enough that a regression could hide inside it.
- **Raising `N`**: only with a one-line reason in the PR description (e.g.
  "enables new rule X, will clean up over next 2 PRs"). A PR that raises
  `N` merely to make its own new warnings pass is the failure mode this
  gate exists to prevent — don't do that; fix the warnings or justify them
  with `_`-prefixing / a narrow `eslint-disable` instead.
- No scheduled owner or cadence. Whoever notices `actual << N` next (via
  `npm run lint` output) is free to send the tightening PR.

## Known remaining warnings (not addressed by this gate)

Two categories are intentionally left in place for now, tracked
separately, counted toward `N` but not otherwise acted on here:
- `no-unused-vars` in `cypress/support/audit_log/helper.ts` and
  `cypress/e2e/audit_log.cy.ts` — orphaned generated artifacts no longer
  produced by the code generator; see the accompanying investigation
  report for the four measurements (does it run, does it pass, does the
  generator still own this path, is its coverage unique) that inform
  whether it's safe to delete.
- `deps`/`records` unused callback args in
  `test_api_spec.cy.ts.jinja2`/`test_spec.cy.ts.jinja2` — a per-call-site
  fix, estimated but not implemented; see the accompanying investigation
  report for the cost estimate.
