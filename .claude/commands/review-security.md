---
description: Security review — authentication, authorization, tenant isolation, injection, XSS, CSRF.
argument-hint: <scope or area to review>
---

This is a **security review** task. Read the relevant source files carefully before evaluating.

Scope: $ARGUMENTS (if empty, review the entire codebase)

Minimum docs to read before starting:
- `docs/knowledge/multi-tenancy-and-permissions.md` — tenant isolation, auth/authz system

## How to run this review

1. Read the relevant source files.
2. Check each item in the checklist below.
3. For each item: state the current implementation, any gaps, and recommended fixes with `file:line` references.

## Checklist

### Authentication & Authorization

- [ ] Credentials provider enforces bcrypt password comparison — `auth.ts` `authorize()` uses `bcrypt.compare()`; SSO-only users (password=null) are rejected before comparison to avoid timing leaks
- [ ] Google OAuth enforces email_verified — `auth.ts` `signIn()` callback rejects `email_verified === false` (`auth.ts:~163`)
- [ ] Optional domain allow-list enforced pre-adapter — `siteConfig.auth.allowedDomains` checked in `signIn()` before any DB write (`auth.ts:~174`)
- [ ] MFA gate active when `user.mfa_enabled = true` — `authorize()` checks `mfa_enabled`, throws `"MFA_REQUIRED"` when code absent, calls `verifyMfaCode()` (`auth.ts:~68`)
- [ ] Credentials↔OAuth email collision blocked — `signIn()` rejects OAuth sign-in for emails with existing non-null `password` (`auth.ts:~220`)
- [ ] API key authentication covered — `lib/api-auth.ts` `authenticateApiKey()` reads `X-API-Key` or `Authorization: Bearer`; negative results cached in TTL-LRU to limit DB probes
- [ ] Session id propagation — `session` callback forwards `user.id` (OAuth) or `token.id` (credentials/JWT) into `Session.user.id` (`auth.ts:~238`)

### Tenant isolation

- [ ] New OAuth users bound to default tenant — `lib/auth/create-user.ts:DEFAULT_TENANT_ID` always writes `tenant_id = "default"` on `createUser`
- [ ] Tenant-level sign-in suspension — `tenant.status` column exists with `'active'`/`'suspended'` states (schema comment: "wired in ticket 1.4"); verify `signIn()` callback actually rejects `status = 'suspended'` users
- [ ] Generated entity models have **no** `tenant_id` column — `db_table`, `field`, and all other generated models rely solely on RBAC for row-level isolation; no DB constraint prevents cross-tenant reads

### SQL injection

- [ ] All DB access goes through Prisma parameterized queries — no raw `$queryRaw` or string-interpolated SQL found in `lib/` or generated `getters.ts`/`actions.ts`; confirm with `grep -r '\$queryRaw\|\$executeRaw' lib/`
- [ ] Pagination sort/filter fields validated against allow-lists — `getters.ts.jinja2` generates `SORTABLE_FIELDS` and `FILTERABLE_FIELDS` Sets; unsupported fields silently dropped via `buildFilter`/`buildOrderBy`

### XSS

- [ ] React default escaping — all generated templates render data into JSX text nodes; no `dangerouslySetInnerHTML` usage found in generated page/form templates
- [ ] MDX rendering — `mdx-components.tsx` present; verify any user-supplied Markdown is sanitized before rendering
- [ ] Raw `<img>` tags present — `ImageDisplay`, `ImageUpload`, `ListWrapper`, `EditableListWrapper`, `OrderedEditableListWrapper` use raw `<img>` instead of `next/image`; arbitrary `src` URLs are rendered without domain restriction

### CSRF

- [ ] NextAuth built-in CSRF — Auth.js v5 issues a CSRF token via `/api/auth/csrf`; credentials form posts must carry it; no additional CSRF middleware in `proxy.ts`
- [ ] JWT cookies — `session.strategy = "jwt"` uses `HttpOnly; SameSite=Lax` cookies (Auth.js default); verify `SameSite` is not overridden in custom cookie config
- [ ] Server Actions — Next.js App Router Server Actions include an implicit CSRF check via the `Origin` header validation; no manual CSRF token needed for form actions

### API route protection

- [ ] UI routes — `proxy.ts` wraps all routes via `auth()` matcher `'/((?!api|_next|_vercel|.*\\..*).*)'`; redirects unauthenticated users to `/{locale}/login`
- [ ] Public paths explicitly listed — `proxy.ts:PUBLIC_PATHS = ['/login', '/register', '/docs']`; additions must be intentional
- [ ] API routes — REST endpoints under `app/api/` use `authenticateApiKey()` from `lib/api-auth.ts`; the middleware matcher does NOT cover `app/api/` except `/api/auth/*`; confirm each `app/api/` route manually calls `authenticateApiKey()` or `auth()`
- [ ] `/api/auth/*` rate-limited — `proxy.ts` applies IP-based rate limiting: credentials 10/min, provider 30/min, callback 60/min

### Secret management

- [ ] `AUTH_SECRET` required — `authConfig.secret = process.env.AUTH_SECRET`; missing at runtime causes JWT signing to fail
- [ ] Google OAuth secrets gated — `isGoogleEnabled()` requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; provider not registered if absent
- [ ] `REDIS_URL` optional but required for production rate limiting — in-memory limiter is per-process and NOT a security boundary in multi-replica prod deployments (`lib/rate-limit/index.ts:~36`)
- [ ] `api_key` stored in plaintext — `user.api_key` column holds the raw key; no hashing; full DB read exposure reveals all keys; consider HMAC-SHA256 storage with prefix-based lookup
- [ ] `.env` files not committed — verify `.gitignore` covers `.env`, `.env.local`, `.env.production`

## Current implementation (proj_a specific)

**Middleware / route protection**: `proxy.ts` (not `middleware.ts`) exports `proxy = auth(async req => {...})` with the Next.js `config.matcher`. All non-API, non-static routes go through `auth()` which resolves the JWT cookie; unauthenticated requests are redirected to `/{locale}/login`. Auth endpoints (`/api/auth/*`) pass through after optional rate-limiting; all other `/api/*` routes are NOT covered by the middleware matcher and must self-authenticate.

**Auth provider**: `auth.ts` wires NextAuth v5 with Credentials (email/password/optional TOTP) and optional Google (feature-flagged via `siteConfig.auth.providers`). Session strategy is globally pinned to `"jwt"` (`auth.ts:~155`) because Auth.js v5 does not correctly mix database sessions for Credentials + OAuth in the same deployment — documented trade-off at `auth.ts:~135`.

**Rate limiting**: sliding-window buckets per IP in `lib/rate-limit/`. In dev/test, `in-memory.ts` is used (counters reset on restart). In prod (`REDIS_URL` set), `redis.ts` uses ioredis for cross-replica state. The ioredis import is dynamic so it is absent from the client bundle when Redis is not configured.

**Tenant creation**: `lib/auth/create-user.ts:createTenantBoundUser` always assigns `tenant_id = "default"` to new OAuth users. Phase 4.1 will introduce invite-based tenant assignment; current phase treats all sign-ups as single-tenant.

**Audit log**: `lib/audit-log.ts:recordAuditEvent()` is called on signIn, signOut, createUser, signIn.reject, and account linking events. Stored in `audit_log` table (`prisma/schema.prisma:~280`).

## Known gaps / improvement areas

- **No server-side session revocation** — JWT strategy means tokens remain valid until expiry even after password reset or account suspension. Mitigation requires either SSO-only (no credentials) or a custom session-revocation shim writing a `Session` row from `authorize()`.
- **Generated entity models have no `tenant_id`** — isolation relies on RBAC. A misconfigured role or a future admin API endpoint could expose cross-tenant data. Adding `tenant_id` to the code generator's Prisma schema template and `WHERE tenant_id = $session.tenant_id` to getters is the structural fix.
- **`api_key` stored in plaintext** — exposure of the `user` table reveals all API keys. Consider HMAC prefix storage.
- **`/api/*` routes not covered by middleware** — each API route file must remember to call `authenticateApiKey()`. Missing it on a new route is a silent auth bypass. A shared route handler wrapper or a test that enumerates `/api/` routes and asserts auth headers required would close this.
- **In-memory rate limiter in prod without REDIS_URL** — no visible error at startup; only discovered under attack. Add a startup check that logs a warning when `NODE_ENV=production` and `REDIS_URL` is absent.
- **Raw `<img>` in display/upload components** — not a direct XSS vector (React escapes `src`), but bypasses `next/image`'s domain restriction and optimization pipeline.
- **Tenant suspension enforcement** — `tenant.status` column exists but verify the `signIn()` callback actually queries and checks `tenant.status` for credentials users (not just OAuth).

## Completion gate

None — read-only review task, no code changes.

> **Note**: When running lint or typecheck in isolation, prefix with
> `npm run generate-code` first. See `AGENTS.md §Generated-code prerequisites
> for gates` for the full rule.
