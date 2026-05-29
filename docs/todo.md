# TODO

Open tickets pulled from `docs/plan.md` requirements and the "Out of scope, for
next time" section of `docs/knowledge/sso-authentication.md` (lines 294-321).

Performance is not currently tracked here — pagination, DB indexing
(`prisma/schema.prisma` `@@index`), and the latency work in
`docs/knowledge/performance-improvements.md` cover the items called out in
`plan.md:12-13`. Add a section back when concrete bottlenecks show up (e.g.
load test, p95 regression, N+1 audit finding).

---

## Security

### S1 — Rate limiting on `/api/auth/*`

**Why:** `plan.md:14` ("security risk is minimized") and
`sso-authentication.md:318-319`. Today the auth endpoints are unprotected;
credential stuffing and SSO callback abuse have no throttle.

**Scope:**
- Next.js proxy (`proxy.ts`) intercepts `/api/auth/*` and applies a per-IP
  rate limit before delegating to Auth.js.
- Store: Redis in prod (Upstash on Vercel today, any TCP-reachable Redis
  later) for shared state across replicas; Docker `redis:7-alpine` locally
  and in Cypress so the test gate exercises the same code path. In-memory
  fallback retained for unit tests that don't stand up Redis.
- Limits: separate buckets for `signin/credentials`, `signin/<provider>`, and
  `callback/*`. Surface 429 with `Retry-After`.
- Cover with a Vitest test + a Cypress regression that hammers `signin`
  and asserts 429.

**References:** `proxy.ts`, `auth.ts`, `sso-authentication.md:294-321`.

**Status:** shipped.
- `lib/rate-limit/redis.ts` — `ioredis`-based adapter; sliding-window log
  in a Redis sorted set inside one Lua script so concurrent requests
  against the same `(bucket, key)` can't race past the limit. Same client
  talks Docker locally and Upstash's TCP endpoint (`rediss://`) in prod.
- `lib/rate-limit/index.ts` — `getRateLimiter()` selects the Redis
  adapter when `REDIS_URL` is set, else the in-memory implementation.
  Env-var renamed from the previous `UPSTASH_REDIS_REST_URL` since the
  shipped adapter is provider-agnostic.
- `docker-compose.test.yml` — new `redis-test` service
  (`redis:7-alpine`, host port `${REDIS_PORT:-6379}`, persistence off so
  tests start clean).
- `.env.example` / `.env.test` — `REDIS_URL` documented; the test env
  binds host port `6381` (off the default to avoid collision with a
  developer's local Redis) and composes `REDIS_URL` from it.
- `package.json` — `ioredis` dependency added; `@upstash/*` not used.
- 6 Vitest cases in `lib/rate-limit/redis.test.ts` covering the Lua
  arg layout, allow/deny decision mapping, per-call member uniqueness,
  the unknown-bucket fail-open, and the construction-time guard when
  neither `REDIS_URL` nor an injected client is supplied.

---

### S2 — Audit-log table

**Why:** `sso-authentication.md:314-317`. Auth events (`events.signIn`,
`events.signOut`, the `[auth:createUser]` log line emitted from
`buildAdapter`) currently go to `console.info` only. Role/permission CRUD has
no audit trail either, which makes "who granted what" unanswerable.

**Scope:**
- New Prisma model `audit_log` (`id`, `actor_user_id`, `action`,
  `target_table`, `target_id`, `metadata Json?`, `created_at`).
- Hook from Auth.js `events.{signIn,signOut,createUser}` into
  `audit_log.create`.
- Hook from generated `role` / `permission` / role-assignment service
  actions — pick the generator seam (likely `service.ts` template) so new
  protected entities pick it up for free.
- Read-only `audit_log` list page gated to a new `audit:read` permission.

**References:** `auth.ts` (`events`), `prisma/schema.prisma`,
`code_generator/templates/service.ts.jinja2`.

---

### S3 — Automated dependency vulnerability scanning

**Why:** `plan.md:15` ("vulnerability of libraries are managed"). One
historical commit (`8f49132 chore: npm module update for security`) shows the
work is currently reactive and manual.

**Scope:**
- Enable Dependabot (or Renovate) on the repo with security + minor-version
  PRs grouped weekly.
- Add `npm audit --production --audit-level=high` to the Type A and Type B
  gates in `AGENTS.md` so a failing audit blocks merge.
- Decide and document policy for `pip` deps in `requirements.txt`
  (pip-audit invocation).

**References:** `AGENTS.md` task-classification gates, `package.json`,
`requirements.txt`.

**Status:** shipped.
- `.github/dependabot.yml` — weekly grouped PRs for npm, pip, github-actions.
- AGENTS.md gates extended: `npm audit --omit=dev --audit-level=high`
  on Type A + B; `pip-audit -r requirements.txt` on Type B.
- `.github/workflows/ci.yml` — new `audit` job runs both on every PR.
- `pip-audit` added to `requirements.txt`.
- The original ticket called for `--production` on `npm audit`; that flag
  was deprecated in npm 7 in favour of `--omit=dev`. The shipped command
  uses the modern form.

---

### S4 — Server-side revocation for credentials sessions

**Why:** `sso-authentication.md:295-305`. JWT is pinned globally for the
mixed-strategy reasons documented at lines 77-107; revoking a credentials
session today requires rotating `AUTH_SECRET` (logs everyone out).

**Scope:**
- Custom session shim called from `authorize()`: write a `Session` row keyed
  by a server-generated token and bind that token to the cookie.
- Resolve sessions against that row in `auth()`; treat missing row as
  unauthenticated.
- Cover token rotation and `expires` handling — see the race-condition note
  at `sso-authentication.md:303-305`.
- Admin "revoke session" action on the user detail page.

**References:** `auth.ts`, `sso-authentication.md:77-107`,
`sso-authentication.md:294-305`.

---

### S5 — MFA / TOTP

**Why:** `sso-authentication.md:306-309`. No second factor on either
credentials or SSO sign-in.

**Scope:**
- TOTP enrollment flow (QR + recovery codes) on the account settings page.
- New Auth.js step after `authorize()` / OAuth `signIn()` that gates session
  issuance on a verified TOTP code when MFA is enabled for the user.
- `user.mfa_secret`, `user.mfa_enabled`, recovery-code table.
- Decide opt-in vs admin-mandated per role; record decision in
  `sso-authentication.md`.

**References:** `auth.ts`, `prisma/schema.prisma`, `app/[locale]/setting/`.

**Status:** phase 5a shipped — credentials-only, opt-in per user.

_Core MFA lifecycle (original phase 5a):_
- `lib/mfa/{crypto,totp,recovery,verify,enrollment}.ts` — AES-256-GCM
  secret-at-rest (key derived from `AUTH_SECRET`); otplib v13 TOTP
  wrapper with ±30 s tolerance; 8 single-use recovery codes
  (base32, bcrypt-hashed); server-side verify + enrollment lifecycle.
- `auth.ts` — credentials `authorize()` throws `MFA_REQUIRED` /
  `Invalid MFA code` when the user has `mfa_enabled=true`.
- `app/[locale]/login/page.tsx` — reveals the MFA TextField on the
  second submission when the first comes back with the sentinel.
- `app/[locale]/setting/mfa/` — `page.tsx` + `mfa-client.tsx` +
  `actions.ts` covering enable / pending-verify / recovery-display /
  enabled-disable state machine.
- `prisma/schema.prisma` — `user.mfa_secret`, `user.mfa_enabled`,
  `mfa_recovery_code` model (working tree only; same WIP carve-out as
  S2's `audit_log`, applied at migration time).
- `messages/{en,ja}.json` — `Auth.mfa*` strings + new `Mfa` section.
- `docs/knowledge/sso-authentication.md` — v1 decision note in the
  "Out of scope, for next time" section.

_Additional features shipped after original phase 5a:_
- `app/[locale]/setting/page.tsx` — replaced CRUD list with an account
  settings hub that includes a direct link to `/setting/mfa`; hub is
  regen-safe via `x-custom-components` (`components/setting/SettingsHub.tsx`).
- `lib/mfa/enrollment.ts regenerateRecoveryCodes` + `actions.ts
  regenerateRecoveryCodesAction` — re-issue fresh recovery codes once
  the user verifies with a current TOTP or an existing recovery code;
  old codes deleted atomically. UI surface in `mfa-client.tsx`.
- `messages/{en,ja}.json` — MFA error codes (`MFA_NOT_ENABLED`,
  `INVALID_CODE`) returned by server actions and surfaced as i18n
  strings so the UI never displays raw error identifiers.
- `user.mfa_enabled` is now schema-exposed via `x-custom-component` MfaToggle
  (`components/_standard/MfaToggle.tsx`); user admin edit page shows enable/disable
  widget; direct boolean flip forbidden, enable redirects to enrollment flow.

_Tests:_
- 32 Vitest cases across `lib/mfa/{crypto,totp,recovery,enrollment}.test.ts`
  (enrollment.test.ts adds 4 cases for `regenerateRecoveryCodes`: happy
  path TOTP, happy path recovery code, MFA-not-enabled guard,
  invalid-code guard).

**Not yet implemented (phase 5b+):** OAuth + MFA challenge, admin role
mandate. Both recorded as deferred in `sso-authentication.md`.

---

### S6 — Generator guard against low-level constraint bypass

**Why:** `plan.md:16` ("Code does not use logic to allow low level access to
bypass constraints"). No automated check today; relies on review discipline.

**Scope:**
- Lint rule (custom ESLint or a `pytest` check on generated output) that
  flags `prisma.$queryRaw`, `prisma.$executeRaw`, and direct FK writes that
  skip the service layer in generated files.
- Allowlist mechanism for the few legitimate uses (document each).
- Wire into Type B gate in `AGENTS.md`.

**References:** `code_generator/templates/`, `AGENTS.md`,
`code_generator/validate.py`.

**Status:** shipped.
- `code_generator/check_generated.py` — re-derives the generator's
  expected file list via `extract_entities` (mirroring `cleanup.py`)
  and scans only those files; `app/generated/` (Prisma client) is
  outside that set by construction.
- Banned everywhere in generator output: `prisma.$queryRaw`,
  `prisma.$executeRaw`, and the `*Unsafe` variants.
- Banned outside the service layer: `prisma.<model>.{create,update,
  delete,upsert,createMany,updateMany,deleteMany}`. Service layer =
  `lib/<entity>/{service,service_validation,service_after_create}.ts`.
  Reads remain allowed so `actions.ts` / api routes can still load
  the row they need for permission checks before delegating.
- `code_generator/check_generated_allowlist.yaml` — empty by default;
  exemptions are `{path, pattern, substring, reason}` tuples matched
  line-by-line.
- `npm run check:generated` runs the check; wired into the AGENTS.md
  Type B gate after `generate-code`.
- 16 Vitest-equivalent pytest cases in
  `code_generator/tests/test_check_generated.py`.

---

### S7 — Account linking UI

**Why:** `sso-authentication.md:310-313`. The schema already supports
multiple `Account` rows per `user`, but a signed-in user can't attach an
additional OAuth provider.

**Scope:**
- "Connected accounts" section on the account settings page listing existing
  `Account` rows and offering a "Connect Google / …" button.
- Server action that invokes Auth.js `signIn(provider, { redirect: false })`
  inside an authenticated context, then links the resulting `Account` row to
  the current `user.id` instead of creating a new user.
- Detach flow with a guard preventing the user from removing their last
  sign-in method.

**References:** `sso-authentication.md:310-313`, `auth.ts`, `app/[locale]/setting/`.

**Status:** shipped — same-email linking. Cross-email deferred.
- `lib/account-link/index.ts` — `listLinkedAccounts`,
  `availableProvidersForLinking`, `hasAnotherSignInMethod`,
  `detachAccount` (transactional last-sign-in-method guard, audit-logged
  as `auth:account.unlink`).
- `auth.ts` — Google provider flipped to
  `allowDangerousEmailAccountLinking: true`. The signIn callback now
  detects an active session via `auth()`; same-email = link (logged as
  `auth:account.link`), different email = reject
  (`auth:signIn.reject` with reason `linking_email_mismatch`). The
  existing credentials/OAuth collision rejection still fires for
  unauthenticated sign-ins, so an attacker can't take over a
  credentials account via a same-email Google account.
- `app/[locale]/setting/page.tsx` — new index linking to `mfa` +
  `accounts`. `app/[locale]/setting/accounts/{page,accounts-client,
  actions}.{ts,tsx}` — list, connect (`signIn(provider, {redirectTo:
  /setting/accounts})`), detach with last-method guard.
- `messages/{en,ja}.json` — new `Setting` + `LinkedAccounts` sections,
  key parity verified.
- 13 Vitest cases in `lib/account-link/index.test.ts` covering list /
  available / detach (password path, multi-account path, last-method
  rejection, not-found rejection, audit metadata).
- `docs/knowledge/sso-authentication.md` — design + security note in
  the "Out of scope, for next time" section.

**Not in this phase:** cross-email linking (attach a Google account
whose email doesn't match the signed-in user's email) — would require
custom Account creation outside the adapter's email-keyed lookup.

---

### S8 — Per-tenant SSO (SAML)

**Why:** `sso-authentication.md:320-321`. Enterprise customers will want
per-tenant SAML.

**Scope:**
- Evaluate SAML Jackson vs WorkOS (build vs buy decision; record in
  `sso-authentication.md`).
- Per-tenant domain binding so `signIn()` routes the right email to the
  right IdP.
- Provisioning model for tenant admins to upload IdP metadata.

**Status:** discovery only — not committed to a release.

**References:** `sso-authentication.md:320-321`.
