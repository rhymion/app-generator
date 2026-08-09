# Rerunning the previous CI run's failing Cypress specs is part of the Completion gate

**Rule**: alongside the mandatory API Cypress step, the Completion gate must
also re-run any spec(s) that failed in the branch's most recent CI run and
confirm they now pass — mechanically, from the CI run's own log, not from
memory or reasoning about the fix. This is additive; it does not replace
any existing step.

## Why (cmd_625, 2026-08-09)

A fix is not confirmed done by reasoning alone: the only way to confirm a
believed-fixed test is actually fixed is to run that specific test again
and observe it pass. This repo's own mandatory gate already runs the full
spec suite (`test:e2e:cy:api` + `test:e2e:cy:ui`), so here a previously-
failed spec — API or UI — is already re-executed by the existing steps.
The gap this closes is in the *consumer* repos: app-template's and
inventory-app's mandatory local gate is API-only (`test:e2e:cy:api`); their
UI suite (`test:e2e:cy:start`) is explicitly deferred to CI, not run
locally (see those repos' `update-code.md` "Two-stage e2e" note). In that
split, a UI spec that failed in a previous CI run would not be re-verified
locally before the next push without this step — an agent could believe a
UI-affecting fix was done, push, and only find out it wasn't from the next
CI run, the exact "gate ≠ CI" failure class already recorded four times
(cmd_489, cmd_498, cmd_600) before this ruling.

## Mechanism

Cypress's default reporter here has no JSON output (`cypress.config.ts`
sets no `--reporter json`), so there is no report file to parse. Failing
spec names are instead extracted from the CI run's raw log text. Each
spec's summary block ends with a "Spec Ran:" line whose color code is red
(`31`) if that spec had any failing test, green (`32`) otherwise:

```
  │ Spec Ran:     approval_flow.cy.ts   │      <- red-coded when failing
```

`gh run view --log-failed` was empirically observed, in this environment,
returning that color code as literal caret text (`^[[31m`) rather than a
raw ESC byte (`\x1b[31m`); the extraction script below matches both forms
so it works either way:

```bash
BRANCH="$(git branch --show-current)"
RUN_ID=$(gh run list --branch "$BRANCH" --workflow=ci.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId' 2>/dev/null)
if [ -z "$RUN_ID" ]; then
  echo "No prior CI run for $BRANCH — step N/A"
else
  ESC=$'\x1b'
  FAILED_SPECS=$(gh run view "$RUN_ID" --log-failed 2>/dev/null \
    | grep -F 'Spec Ran:' \
    | grep -F -e "${ESC}[31m" -e '^[[31m' \
    | sed -E "s/${ESC}\[[0-9;]*[A-Za-z]//g" \
    | sed -E 's/\^\[\[[0-9;]*[A-Za-z]//g' \
    | sed -E 's/^.*Spec Ran:[[:space:]]*//; s/[[:space:]]*│[[:space:]]*$//; s/[[:space:]]+$//' \
    | sort -u)
  if [ -z "$FAILED_SPECS" ]; then
    echo "Run $RUN_ID had no failing Cypress specs — step N/A"
  else
    SPEC_ARG=$(echo "$FAILED_SPECS" | sed 's#^#cypress/e2e/#' | paste -sd,)
    echo "$SPEC_ARG"
  fi
fi
```

`gh run list --workflow=ci.yml --limit 1` picks the branch's most recent
run regardless of `push`/`pull_request` event — the same run the branch's
next push will be compared against. If `FAILED_SPECS` comes back empty
even though the run's overall `conclusion` was `"failure"`, the failure was
in a non-Cypress job (`Lint`, `pytest`, `audit`, …) — there is nothing to
re-run here, and that's expected, not a bug in the extraction.

## Rerunning the extracted specs

app-generator (this repo) — reuse the same `run-e2e.js` wrapper the
`test:e2e:cy:api`/`test:e2e:cy:ui` npm scripts already use, just with a
narrower `--spec`:

```bash
node scripts/run-e2e.js test:e2e:start \
  "cypress run --browser chromium --spec \"$SPEC_ARG\""
```

app-template / inventory-app — the Cypress config and `run-e2e.js` live
inside the `app-generator/` submodule there, and the top-level `npm run
test:e2e:cy:api` script hardcodes its own `--spec` glob (can't take a
custom one through `npm --prefix`), so invoke directly from inside the
submodule:

```bash
(cd app-generator && node scripts/run-e2e.js test:e2e:start \
  "cypress run --browser chromium --spec \"$SPEC_ARG\"")
```

Both forms need the app already built (`test:e2e:build` already ran
earlier in the gate) — the same precondition the existing
`test:e2e:cy:api`/`test:e2e:cy:ui` steps need, which is why this step sits
immediately alongside them rather than earlier in the gate's step order.

## Verification (cmd_625, 2026-08-09)

The extraction script above was run against a real failing run
(`app-generator` run `31249225146`, branch
`doreen/subtask_618a_option_kou_kai_namespace_phase1`) and returned exactly
`approval_flow.cy.ts`, `approval_flow_same_entity_autocomplete_filter.cy.ts`,
`permission.cy.ts`. Cross-checked against that same run's final Cypress
results table (the rows marked with the fail glyph, red): the identical
three specs were the only ones marked failing out of 39 total — confirming
the extraction is accurate, not just plausible-looking. See the
`subtask_625f_gate_doc_rerun_failed_tests` report for the full transcript.

## Scope note

This is a local-only discipline check: no CI job runs "rerun the specs
that failed last time" (that would be circular — CI has no visibility into
its own previous run's failures as an input to itself). Its enforcement
depends on the gate being followed like every other step in this list;
nothing in CI catches a skipped rerun. It is purely additive — it does not
skip, narrow, or replace `test:e2e:cy:api`/`test:e2e:cy:ui`/`test:e2e:cy:start`.
