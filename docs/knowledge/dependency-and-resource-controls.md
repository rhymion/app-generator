# Dependency controls and resource-demanding functions

What the repository does today to keep dependencies trustworthy, and where the limits that protect resource-heavy functions live. Other documents own the details; this page is the index. It maps to OWASP ASVS 5.0 V15.1.1, V15.1.2 and V15.1.3 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Dependency controls in place

| Control | Where | Behavior |
|---|---|---|
| Locked installs | `package-lock.json`, `requirements.txt`; CI runs `npm ci` | Installs resolve to the recorded versions. `npm ci` fails if the lock file and `package.json` disagree. |
| Blocking audit | `.github/workflows/ci.yml`, job `audit` | `npm audit --omit=dev --audit-level=high` and `pip-audit -r requirements.txt`. A high or critical advisory in a production dependency fails the job. |
| Non-blocking full-scope audit | `ci.yml`, job `audit-full-scope` | Same threshold over the whole npm tree including `devDependencies`; never fails the run. The JSON result is kept as an artifact for 30 days. |
| Second-opinion scan | `.github/workflows/osv-scanner.yml` | OSV-Scanner over both lock files on pull requests that touch them and weekly on a schedule. Report-only; see [ci-security-workflows.md](ci-security-workflows.md) for the criteria to make it blocking. |
| Automated update PRs | `.github/dependabot.yml` | npm, pip and GitHub Actions are scanned weekly (Monday 08:00 Asia/Tokyo). Security-advisory PRs are raised immediately, regardless of schedule. Routine updates are grouped; major bumps are split out. |
| Pinned workflow actions | every file under `.github/workflows/` | Each `uses:` is pinned to a full commit SHA. `code_generator/tests/test_own_workflows_hardened.py` fails if that is lost. |
| Task gates | `.claude/commands/*.md`, `## Completion gate` | `npm audit --omit=dev --audit-level=high` runs in the gate of the task types that change code or only prose, so the audit also runs on changes that are not Dependabot PRs. |

## Where packages come from

Application dependencies come from the public npm registry and PyPI, resolved through the lock files above. The repository has no private registry, no mirror and no allow-list of publishers: any package the lock file names is installable. A new dependency is accepted through code review of the lock file diff and the audit jobs; nothing else restricts its source.

## What is not defined

- **Remediation time frames.** The only enforced rule is the CI threshold: high and critical advisories in production dependencies block a merge. There is no written deadline by which an advisory must be fixed once found, and no time frame per severity. Moderate and low advisories are not gated.
- **SBOM.** No workflow generates or publishes a software bill of materials. The lock files are the only inventory of dependencies.

Both are tracked in the Issue linked from the V15.1.1 and V15.1.2 rows of the coverage table.

## Resource-demanding functions and their limits

Each limit is configured where the function runs; the table lists where to find it. Values are the defaults in the code.

| Function | Limit | Default | Override | Defined in |
|---|---|---|---|---|
| List endpoints | Page size ceiling | 200 rows | none | `lib/_pagination.ts` (`MAX_PAGE_SIZE`; `lib/_pagination.test.ts` covers the clamp, and `code_generator/tests/test_getter_include_depth_bounded.py` fails if a generated getter nests its relation `include` deeper than three levels) |
| File upload (`POST /api/upload`) | Size, checked before the body is buffered | 10 MiB plus 64 KiB multipart framing | `UPLOAD_MAX_BYTES` | `lib/_upload_validation.ts` |
| File upload | Rate | 30 per user per 10 minutes (`upload:file`) | `RATE_LIMIT_UPLOAD_LIMIT` | `lib/rate-limit/index.ts` |
| CSV import | Rows | 5000 | `IMPORT_MAX_ROWS` | `code_generator/templates/api_import_route.ts.jinja2` |
| CSV import | Bytes | 10 MiB | `IMPORT_MAX_BYTES` | same template |
| REST reads with an API key | Rate | 300 per minute per user (`api:read`) | `RATE_LIMIT_API_READ_LIMIT` | `lib/rate-limit/index.ts` |
| REST writes with an API key | Rate | 60 per minute per user (`api:write`) | `RATE_LIMIT_API_WRITE_LIMIT` | same |
| Credential sign-in | Rate | 10 per minute (`auth:signin:credentials`) | `RATE_LIMIT_AUTH_CREDENTIALS_LIMIT` | same |
| Registration | Rate | 5 per 10 minutes (`auth:register`) | none | same |
| MFA challenge and current-password confirmation | Rate | 10 per 5 minutes (`auth:mfa:challenge`, `auth:password:confirm`) | none | same |
| Mobile token exchange | Rate | 5 per 15 minutes (`mobile:auth:token`) | `RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT` | same |
| Database connections | Pool size per adapter | 5 (`lib/prisma-pool.ts`) | `PRISMA_POOL_MAX` | `lib/prisma.ts` |

The rate-limit buckets share one mechanism with an in-memory and a Redis adapter; see [api-idempotency-and-rate-limiting.md](api-idempotency-and-rate-limiting.md) for how keys are formed and what happens when Redis is unreachable. A limited request gets HTTP 429 with `Retry-After`.

Not limited by the code: request body size on JSON routes other than upload and import (the hosting platform's request-size cap applies), and the duration of a request (set by the hosting platform). Neither is configured in this repository.
