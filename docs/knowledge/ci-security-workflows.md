# CI security workflows and the vulnerability reporting policy

## Reporting policy

`SECURITY.md` at the repository root is the policy GitHub shows on the
Security and quality tab. Reports go through GitHub private vulnerability reporting, which
is enabled on the repository. The stated response targets are an
acknowledgement within 5 business days and a first assessment within 10
business days. The same text is carried by `app-template`.

## Workflow hardening

Every file under `.github/workflows/`:

- pins each `uses:` reference to a full 40-character commit SHA with a
  trailing `# vX.Y.Z` comment, and
- declares `permissions: contents: read` at the top level. A job that needs
  more (the CodeQL analysis job needs `security-events: write`) declares that
  itself.

`code_generator/tests/test_own_workflows_hardened.py` fails when either
property is lost. The canonical consumer workflow is checked separately by
`test_consumer_ci_action_pins.py`.

To bump an action, resolve the new tag to its commit SHA, replace both the SHA
and the version comment, and keep them in step.

## CodeQL

`.github/workflows/codeql.yml` is the advanced setup. It analyses `actions`,
`javascript-typescript` and `python` with the `security-extended` query suite,
on pushes and pull requests to `develop` and `main`, and weekly.

GitHub's CodeQL *default setup* and an advanced workflow conflict, so the
default setup must be switched off (`state: not-configured` on the
`code-scanning/default-setup` endpoint) when the workflow lands. Alerts are
reviewed by maintainers before anyone discusses their content publicly.

## OSV-Scanner

`.github/workflows/osv-scanner.yml` gives a second opinion next to `npm audit`
and `pip-audit`. It scans `package-lock.json` and `requirements.txt` only; the
generated mobile app's dependencies are covered by the mobile dependency audit
and are out of scope.

| Trigger | Behaviour |
|---|---|
| weekly (Monday) and manual | full scan, SARIF uploaded to code scanning |
| pull request touching a scanned file | compares head with base and lists newly introduced vulnerabilities in the job log; no SARIF upload, because a fork or Dependabot token cannot write code-scanning results |

Both jobs run with `fail-on-vuln: false`, so they report and never block. They
are not a required check. Criteria for making the pull-request scan blocking
(flip `fail-on-vuln` to `true` and add it to the required checks): at least
four consecutive weekly runs with no finding that the existing gates
(`npm audit --audit-level=high`, `pip-audit`) did not also report, and a
written rule for advisories OSV reports but the other sources do not
(accept with a dated reason, or fix).

## OpenSSF Scorecard

`.github/workflows/scorecard.yml` runs the Scorecard action weekly (and on
branch-protection changes and manually) and uploads SARIF to code scanning
under the `scorecard` category; it also publishes the score to the public
Scorecard API. It is report-only. Its job holds `security-events: write` and
`id-token: write` (the latter for result publishing); the workflow default
stays `contents: read`. A check that scores below 5 is either opened as a
follow-up Issue or recorded as accepted, with a reason, on the tracking Issue.

## Static checks run by CI

Two checks that used to run only by hand are CI steps:

| Check | Where |
|---|---|
| `npm run check:generated` | `E2E Tests` job, right after the app is generated and built |
| `npm run check:handwritten-routes` | the `Hand-written Route Guards` job |

A new violation reported by either is a finding to fix, not something to add
to an allowlist to turn the run green.
