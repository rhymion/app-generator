# Content Security Policy (report-only)

Every page response carries `Content-Security-Policy-Report-Only` with a nonce created for that request. The browser reports what the policy would block and blocks nothing. The enforced header from `lib/security-headers.ts` (`Content-Security-Policy: frame-ancestors 'none'`) is a separate header and is unchanged.

## How it works

- `proxy.ts` calls `generateNonce()` (`lib/csp.ts`, 128 random bits) for each page request, builds the policy with `cspReportOnlyFromEnv()` and sets the policy on the response. It also sets the nonce (`x-nonce`) and the policy on the request headers before next-intl runs; next-intl copies the request headers into the forwarded request. Next.js reads the nonce from the policy and stamps its own inline scripts with it.
- `app/layout.tsx` reads `x-nonce` and passes it to `AppRouterCacheProvider` (`options.nonce`), so the `<style>` tags that Material UI (Emotion) inserts carry the nonce.
- API routes, Auth.js routes and static files do not pass through this part of the proxy and get no policy.

The policy:

| Directive | Value |
|-----------|-------|
| `default-src` | `'self'` |
| `script-src` | `'self'`, the nonce, `CSP_EXTRA_SCRIPT_SRC` (and `'unsafe-eval'` in `next dev` only) |
| `style-src` | `'self'`, the nonce |
| `style-src-attr` | `'unsafe-inline'` (React renders `style={{ ... }}` as style attributes) |
| `img-src` | `'self'`, `data:`, `blob:`, `CSP_EXTRA_STORAGE_SRC` |
| `media-src` | `'self'`, `blob:`, `CSP_EXTRA_STORAGE_SRC` |
| `connect-src` | `'self'`, `CSP_EXTRA_STORAGE_SRC` |
| `font-src` | `'self'`, `data:` |
| `object-src` | `'none'` |
| `base-uri` | `'none'` |
| `form-action` | `'self'` |
| `report-uri` | `/api/security/csp-report` |

## Violation reports

`POST /api/security/csp-report` accepts the `application/csp-report` and `application/reports+json` formats without a session. It is rate limited per IP (`csp:report`, 120 per minute), accepts bodies up to 16 KiB and answers 204. It logs one `[csp:violation]` warning through `lib/logger.ts` per report with only `directive`, `blocked`, `page` and `disposition`. URLs keep scheme, host and path; query strings, fragments, referrers, source files, line numbers and script samples are dropped (`lib/csp-report.ts`).

Read the log for violations before the policy is enforced. Enforcing it (sending the same policy as `Content-Security-Policy`) is a separate decision, made after the reports show no violations.

## Widening the policy

Set the origins in the environment (space- or comma-separated; entries that are not plain schemes or origins are dropped):

- `CSP_EXTRA_SCRIPT_SRC` — origins of external scripts (an analytics tag, a payment widget).
- `CSP_EXTRA_STORAGE_SRC` — origins that serve or receive files (for example `https://storage.googleapis.com` for a GCS bucket, or the Vercel Blob host). Added to `img-src`, `media-src` and `connect-src`.

A hand-written page that needs more (an iframe, a font host) edits `buildCspReportOnly()` in `lib/csp.ts`. A hand-written inline `<script>` or `<style>` must carry the request nonce: read it with `(await headers()).get(CSP_NONCE_HEADER)` in a Server Component and pass it as the `nonce` attribute (`<Script nonce={nonce}>`).

## Tests

`lib/csp.test.ts`, `lib/csp-report.test.ts`, `app/api/security/csp-report/route.test.ts` and `cypress/e2e/csp_report_only.cy.ts` (header and nonce on public and signed-in pages, the unchanged enforced header, the report route).
