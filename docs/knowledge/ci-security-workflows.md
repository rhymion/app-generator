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

## Security Checks workflow

`.github/workflows/security-checks.yml` runs on pull requests and on pushes to
`main` and `develop`, weekly, and on demand. It uses no secret, and its checks
are not path-filtered, so each one reports on every pull request.

| Job | Blocks? | What it does |
|---|---|---|
| Secret Scan (gitleaks) | yes | Runs the `gitleaks` CLI (pinned version, SHA-256 checked; not the GitHub Action, which needs a license for organizations). A pull request is scanned over the commits it adds; pushes and the weekly run scan the full history. |
| Dependency Review | yes | `actions/dependency-review-action` fails a pull request that adds or bumps a dependency to a version with a High or Critical advisory. |
| Semgrep | project rules: yes; registry packs: no | `scripts/semgrep_scan.sh` scans the repository sources and a freshly generated app. |

### gitleaks

Reviewed findings of the full-history scan are listed in `.gitleaksignore`,
each with the reason it is not a credential. An entry is an exact
`commit:file:rule:line` fingerprint, so a new secret of the same shape in the
same file is still reported. Do not add an entry to turn a run green: rotate
the credential, or record why the value is harmless.

Run it locally with `gitleaks detect --source . --redact`.

GitHub secret scanning and push protection are repository settings, not files.
They are verified with
`gh api repos/rhymion/app-generator --jq .security_and_analysis`.

### Semgrep

- **Project rules** live in `.semgrep/rules.yml` with test cases in
  `.semgrep/rules.ts` and `.semgrep/rules.tsx` (`cd .semgrep && semgrep test .`).
  They are blocking from the start because the tree has no findings: raw
  `$queryRawUnsafe` / `$executeRawUnsafe`, `dangerouslySetInnerHTML`, and
  `eval()` / `new Function()`.
- **Registry packs** (`p/typescript`, `p/nextjs`, `p/owasp-top-ten`) are
  report-only. Their SARIF files are uploaded as the `semgrep-results` artifact
  and the counts are written to the job summary. They become blocking, for
  findings that are new relative to the baseline below, once the baseline is
  triaged.
- **Generated app**: `generate-code` runs in a scratch copy of the tree and the
  same scans run on the copy. The generator repository holds its generated
  output in place, so today the generated scan reports the same findings as
  the source scan.

Run both scans locally with `bash scripts/semgrep_scan.sh --registry`
(needs `semgrep` and the packages in `requirements.txt`; results go to
`semgrep-results/`).

Registry baseline, measured with Semgrep 1.183.0 when this was added (10
findings):

| Rule | Count | File |
|---|---|---|
| `dependabot-missing-cooldown` | 6 | `.github/dependabot.yml` |
| `missing-autoescape-disabled` | 2 | `code_generator/generate.py`, `code_generator/generate_types.py` |
| `gcm-no-tag-length` | 2 | `lib/compliance/attachment_name_crypto.ts`, `lib/mfa/crypto.ts` |

The Jinja2 findings are intended: the templates generate TypeScript, not HTML.
The two `gcm-no-tag-length` findings need a decision on whether to pass an
explicit authentication tag length to `createDecipheriv`.

## Workflow Lint

`.github/workflows/workflow-lint.yml` runs `actionlint` and `zizmor` on pull
requests and pushes that touch `.github/`. Both fail on any finding. It is
path-filtered, so do not make its checks required in branch protection.

`.github/zizmor.yml` requires every action to be pinned to a commit SHA and
suppresses `dependabot-cooldown`, with the reason in the file. `pull_request_target`
is reported by zizmor's `dangerous-triggers` audit and is not used. Every
`actions/checkout` step sets `persist-credentials: false`.

Run both locally with `zizmor --no-online-audits .github` and `actionlint`.

`actionlint` runs `shellcheck` on every `run:` script only when `shellcheck` is on
`PATH`, and it skips that check silently otherwise. A local `actionlint` that exits 0
on a machine without `shellcheck` is therefore not equivalent to the CI run, which has
it. Install `shellcheck` first (for example `pip install shellcheck-py` into a venv)
and confirm it is found with `which shellcheck` before trusting a clean result. A
`shellcheck` directive must be on its own comment line; text after the code on the
same line is a parse error.

## Static checks run by CI

Two checks that used to run only by hand are CI steps:

| Check | Where |
|---|---|
| `npm run check:generated` | `E2E Tests` job, right after the app is generated and built |
| `npm run check:handwritten-routes` | the `Hand-written Route Guards` job |

A new violation reported by either is a finding to fix, not something to add
to an allowlist to turn the run green.

See also [security-asvs-coverage.md](security-asvs-coverage.md), which maps each OWASP ASVS 5.0 requirement to the code, test or Issue that covers it.
