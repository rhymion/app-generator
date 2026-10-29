# CI security workflows and the vulnerability reporting policy

## Reporting policy

`SECURITY.md` at the repository root is the policy GitHub shows on the
Security tab. Reports go through GitHub private vulnerability reporting, which
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

## Static checks run by CI

Two checks that used to run only by hand are CI steps:

| Check | Where |
|---|---|
| `npm run check:generated` | `E2E Tests` job, right after the app is generated and built |
| `npm run check:handwritten-routes` | the `Hand-written Route Guards` job |

A new violation reported by either is a finding to fix, not something to add
to an allowlist to turn the run green.
