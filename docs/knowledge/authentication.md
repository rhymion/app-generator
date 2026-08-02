# SSO Authentication

The generated app supports SSO sign-in alongside email/password credentials.
Today only Google is wired up; the layering is designed so adding GitHub /
Microsoft / generic OIDC is a small, contained change.

The auth stack is **Auth.js v5** (`next-auth@5.0.0-beta`) on top of
`@auth/prisma-adapter`. `session.strategy = "jwt"` is pinned globally
— Auth.js v5's mixed-strategy story doesn't survive runtime when both
Credentials and OAuth are configured (see "Session strategy" below).
The adapter still writes `User` / `Account` rows on OAuth sign-in for
identity stability, just not `Session` rows. MFA / TOTP is shipped for
both the credentials provider and the OAuth path (opt-in per user, see
`lib/mfa/` and "MFA on the OAuth path" below); admin-mandated MFA is
not in scope for this iteration.

---

## Architecture at a glance

```
┌──────────────────────────────┐
│ lib/site-config.ts           │  siteConfig.auth.providers   — UI gate
│   auth.providers:            │  siteConfig.auth.allowedDomains
│     ['credentials','google'] │     (optional domain restriction for OAuth)
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ auth.ts                      │  buildProviders()         — server gate
│   if siteConfig allows       │  buildAdapter() wraps
│   && env vars present        │     PrismaAdapter(prisma) — overrides
│     → register provider      │     createUser to fill domain-required
│                              │     fields (name, creator_id, updater_id)
│                              │  session.strategy: 'jwt' (pinned)
│                              │  exports { handlers, auth, signIn, signOut }
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Auth.js v5                   │  Adapter writes the `user` row directly
│   - OAuth via adapter        │     on first OAuth sign-in, plus an
│     (JWT cookie)             │     `Account` row recording (provider,
│   - Credentials direct       │     providerAccountId). `Session` table
│     (JWT cookie)             │     stays empty under JWT strategy.
│                              │  Credentials never touches the adapter
│                              │  — authorize() returns a user object,
│                              │  Auth.js mints the JWT.
└──────────────────────────────┘
```

PrismaAdapter expects to read/write `prisma.user`, `prisma.account`,
`prisma.session`, `prisma.verificationToken`. The schema's domain `user`
table satisfies the first one — Prisma derives the client name by
lower-casing the model name, so `model user` exposes `prisma.user` exactly
as the adapter requires. The other three are PascalCase NextAuth-only
tables at the bottom of `prisma/schema.prisma`, a deliberate exception to
the snake_case convention. `Account` is populated on every OAuth sign-in;
`Session` is **unused today** (we run on `session.strategy = "jwt"` —
see "Session strategy" below); `VerificationToken` lights up if/when a
magic-link provider is added.

Two gates have to agree before a provider button works:

1. **UI gate** — `siteConfig.auth.providers` in `lib/site-config.ts`.
   The login page only renders buttons for providers listed here.
2. **Server gate** — required env vars (e.g. `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` for Google). `auth.ts` skips registering the
   provider if either is missing, so the OAuth callback URL would 404
   even if a button somehow leaked through.

If a provider is listed in `siteConfig` but its env vars aren't set,
clicking the button reaches `/api/auth/signin/google` with no `google`
provider registered — Auth.js returns an error. Keep the two in sync, or
use a deployment check that asserts both are present together.

---

## Session strategy — pinned to JWT (and why)

`auth.ts` sets `session: { strategy: "jwt" }` for the whole deployment.
That looks like a regression from the "mixed-strategy" claim earlier
v5-migration drafts made — it isn't. Here's the trap:

- Auth.js v5's config-time assert (`@auth/core/lib/utils/assert.js`)
  only rejects `strategy: "database"` when **only** the Credentials
  provider is configured. With Credentials + Google together, the
  config validates fine.
- At runtime, however, a credentials sign-in **always** sets a JWT
  cookie (`authjs.session-token`) regardless of the configured
  strategy. There is no Auth.js code path that creates a `Session`
  row from `authorize()`'s return value.
- The session resolver (`/api/auth/session`, `auth()`) running in
  database mode then tries to look up that cookie value in the
  `Session` table, finds nothing, and returns `null`.

Net result of `session.strategy = "database"` with Credentials +
Google: the user "logs in" (HTTP 302 to `/`, cookie set), but every
subsequent request resolves to an anonymous session — `useSession()`
sees `null`, the proxy redirects to `/login`, and the user appears
stuck on the login screen. Cypress UI tests catch this immediately:
`cy.contains('Sign Out').should('be.visible')` times out.

Pinning JWT for everyone is the trade-off. OAuth users no longer get
server-side revocation via row delete — both flows ride a signed
cookie. The adapter still writes `User` and `Account` rows on OAuth
sign-in (identity stability via `providerAccountId`, refresh tokens at
rest, headroom for a future Auth.js release that fixes the mixed-mode
gap). Only the **Session row stays empty**.

Two paths to recover server-side revocation when needed:

1. **Drop Credentials entirely.** SSO-only deployment, flip
   `session.strategy = "database"`, full revocation by
   `DELETE FROM Session`. Already correct config-wise — Auth.js v5
   only asserts when *only* Credentials is configured.
2. **Custom session shim.** In `authorize()` (or a follow-up
   callback), call `adapter.createSession(...)` to write a Session
   row keyed by a server-generated token, and bind that token to the
   cookie instead of the default JWT. Several open issues on the
   Auth.js repo trail this pattern; brittle and not officially
   supported.

Server-side revocation for the credentials boundary is therefore
explicitly **not** delivered by this iteration.

`AUTH_SECRET` is required and must be distinct per environment — the
test env has a generated 64-char hex; production must set its own.
Auth.js v5 also reads `NEXTAUTH_SECRET` and `NEXTAUTH_URL` as aliases
for `AUTH_SECRET` / `AUTH_URL` for backward compat; we use `AUTH_SECRET`
plus `NEXTAUTH_URL` (the latter is retained for the Google redirect-URI
documentation since Google Cloud Console UIs and the `.env.example`
both spell it that way).

---

## Google — turning it on

1. Create credentials at the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Add `${NEXTAUTH_URL}/api/auth/callback/google` (e.g.
   `http://localhost:3000/api/auth/callback/google` in dev) to the
   authorized redirect URIs.
2. Set env vars (see `.env.example`):
   ```bash
   GOOGLE_CLIENT_ID="..."
   GOOGLE_CLIENT_SECRET="..."
   ```
3. Make sure `'google'` is in `siteConfig.auth.providers`. It is by default.
4. Restart the dev server.

To **disable** Google without unsetting the env vars (e.g. on a tenant
that shouldn't see the button), remove `'google'` from
`siteConfig.auth.providers`. Note that this also flips `session.strategy`
back to `"jwt"` if Google is the only OAuth provider — existing OAuth
`Session` rows become orphans and the cookie can't be used to recover a
session.

To **ship an SSO-only deployment**, remove `'credentials'` from
`siteConfig.auth.providers`. The email/password form, `Register` link, and
credentials `authorize()` are all gated on that entry. The `Register`
route still exists code-wise but is unreachable from the login UI.

---

## First-time SSO sign-in (auto-provisioning)

On the first Google sign-in for a given email:

1. `signIn()` callback runs **before** the adapter writes anything.
   It enforces:
   - `profile.email_verified !== false` (Google sets this for all
     completed accounts; an explicit `false` is rejected).
   - `siteConfig.auth.allowedDomains` — if non-empty, the email's
     `@domain` must be on the list (case-insensitive). Empty list =
     allow all.
   - The **credentials↔OAuth collision rule**: if a `user` row already
     exists for this email with `password !== null`, that account was
     created via `/register`. SSO sign-in is rejected with reason
     `email_in_use_by_credentials`. Without this guard, the adapter
     would attempt to create a new `user` row and hit the
     `@unique(email)` constraint — same outcome, less explicit. Admin
     reconciliation step: pre-populate a matching `Account` row to link
     the existing user to the OAuth identity.
2. If `signIn()` returns true, `buildAdapter().createUser()` (our
   wrapper around `PrismaAdapter`) inserts the `user` row with:
   pre-generated cuid, `email`, `name = profile.name ?? email`,
   `emailVerified`, `image`, and self-referencing `creator_id` /
   `updater_id` matching the new id. The wrapper exists because the
   default `PrismaAdapter` only writes the NextAuth-shape fields, but
   our `user` table requires non-null `name` plus the audit-bootstrap
   pattern shared with `/api/auth/register`. Note: v5 passes
   `createUser` a full `AdapterUser` with a pre-generated id; we
   replace it with `createId()` to keep the cuid2 convention. The
   returned id is what the adapter then uses for the subsequent
   `Account` and `Session` row inserts, so the FKs stay correct.
3. The adapter then writes the `Account` row recording
   `(provider, providerAccountId, refresh_token, access_token, …)` and
   the `Session` row that backs the user's session cookie.
4. `events.signIn` fires, emitting a structured `[auth:signIn]` JSON
   line with `isNewUser: true` (it's `null` for credentials sign-ins
   because credentials never goes through the adapter).

No role is assigned. An admin grants roles after the user appears in
the `user` table. This is intentional — auto-granting roles via SSO is
the kind of decision that should be explicit per deployment.

### Returning OAuth sign-in

The adapter finds the existing `Account` row by
`(provider, providerAccountId)`, reads its `userId`, and reuses the
same `user` row. A fresh `Session` row is written for the new
sign-in's cookie. `signIn()` runs but doesn't trip the collision rule
because the matching `user` row was created via SSO
(`password === null`). No `createUser` is called on the adapter.

This is the **identity-stability win** of the adapter: if a Google
user changes their primary email, the `providerAccountId` is the same
so they stay the same `user` row. (The previous, pre-adapter
implementation matched by email, so the same event would have created
a brand-new domain user.)

---

## MFA on the OAuth path

MFA applies to **every interactive login provider**, not just
Credentials. This wasn't always true: through S7, `mfa_enabled` was
only checked inside `CredentialsProvider.authorize()` (auth.ts). An
SSO-provisioned user (`password === null`, so the credentials↔OAuth
collision guard in `signIn()` never fires for them — see "First-time
SSO sign-in" above) with MFA enabled could sign in via Google and land
in a fully authenticated session with the second factor never checked.
Fixed in S8 (cmd_527).

**Mechanism — `mfa_pending` on the JWT, enforced by `proxy.ts`:**

```
OAuth sign-in completes
  → jwt() callback: account.provider !== "credentials" && user.mfa_enabled
    → token.mfa_pending = true
  → session() callback exposes session.mfa_pending

proxy.ts, every request
  → req.auth.mfa_pending && path !== /mfa-challenge
    → redirect to /mfa-challenge?callbackUrl=<original path>

/mfa-challenge (app/[locale]/mfa-challenge/)
  → user submits a TOTP or recovery code (verifyMfaCode() — same
    TOTP→recovery fallback the credentials path uses)
  → on success: unstable_update({ mfa_pending: false })
  → jwt() callback (trigger: "update") clears the flag
  → full page navigation (window.location, not the client router — see
    the page's handleSubmit comment) to the original destination
```

Credentials sign-in does **not** set `mfa_pending`: `authorize()`
already requires a valid code before a JWT is ever minted, so there's
nothing left to challenge.

**Session-persistence gap — `mfa_token_version`:** enabling MFA does
not, by itself, revoke an already-active JWT (JWT strategy has no
server-side session table to delete a row from). Without a fix, a user
with a long-lived session could enable MFA and still ride the
pre-existing cookie unchallenged for up to `JWT_MAX_AGE` (default 30
days) — for either provider, not just OAuth. `user.mfa_token_version`
(`Int @default(0)`) closes this: `completeEnrollment()`
(`lib/mfa/enrollment.ts`) increments it when MFA is enabled; the
`jwt()` callback snapshots the version into the token at sign-in and
re-compares it against the DB on **every** subsequent session read (the
`account`-less branch — see auth.ts). A mismatch re-arms `mfa_pending`
immediately instead of waiting for the token to expire.

**Cost/trade-off**: the version re-check is one indexed primary-key
lookup on every authenticated request (not just MFA-enabled users,
since there's no cheaper way to know a user *doesn't* have MFA without
asking the DB) — the same cost class as the authz permission cache this
app already pays for (`lib/authz.ts`), but without that cache's TTL:
correctness here means checking on every request, not a stale window.
Acceptable for a generated-app baseline; revisit with caching (careful —
caching would reintroduce the exact revocation delay this field exists
to close) if it shows up in profiling for a specific deployment.

**API keys are unaffected by any of this.** `authenticateApiKey()`
(`lib/api-auth.ts`) has no MFA check by design — API keys are
machine-to-machine, long-lived credentials with their own secret; MFA
is an interactive-login concept. This boundary is intentional, not a
gap.

**Testing without real Google credentials**: `auth.ts` registers an
additional CredentialsProvider under `id: "google"` when
`isMockGoogleOAuthTestEnabled()` (`lib/auth/mock-oauth-gate.ts`) returns
true. Auth.js sets `account.provider = provider.id` for any
Credentials-shaped provider regardless of its `id`, so this reaches the
exact same OAuth branch of `signIn()`/`jwt()` a real Google sign-in
would, via a real HTTP POST to `/api/auth/callback/google` — with zero
outbound calls to Google and zero real Google credentials. See
`cypress/e2e/auth/mfa.cy.ts` (`mockGoogleSignIn()`) for the test-side
contract.

**Double-gated (cmd_528)** — a single env var is not an acceptable gate
on its own here: the mock provider's `authorize()` looks a user up by
email with no password or MFA check, so if `MOCK_GOOGLE_OAUTH_TEST=true`
ever leaked into a real deploy's environment (e.g. a platform env var
mistakenly scoped to "all environments" instead of just Preview),
anyone who knows a user's email could sign in as them. Registration
requires **both**:

1. `MOCK_GOOGLE_OAUTH_TEST=true` (set only in a gitignored
   `.env.test.local`, never in a committed env file), **and**
2. The filesystem sentinel file `.mock-oauth-test-sentinel` (repo root,
   gitignored) existing.

The sentinel is written only by `scripts/write-mock-oauth-sentinel.js`,
which is wired into the `pre*` hooks of every `test:e2e:*` npm script
that builds or starts the server (`package.json`). It is **not** part of
`build`, `build:full`, or `vercel-build` — the only commands any real
deployment pipeline runs — so the sentinel never exists in a real
deploy's filesystem, regardless of what env vars are set there. Enabling
the mock provider in production would require both a dashboard env var
change AND a code/pipeline change that ships the sentinel writer into
the build — a materially different, PR-reviewed change, not a dashboard
toggle.

A second *env var* was considered and rejected as insufficient: it would
sit behind the exact same "flip it in the platform dashboard" channel as
the first one, so it wouldn't add an independent gate. A
`NODE_ENV === 'test'` check was also considered and rejected:
`next build` (Turbopack) bakes in `process.env.NODE_ENV` at build time
regardless of the runtime env — and this isn't limited to the
`process.env.NODE_ENV` member-access form. Experimentally verified
(cmd_528, throwaway probe route + `next build` + grep on the compiled
output): `process.env["NODE_ENV"]` (bracket notation) and even
`process.env[k]` for a module-level `const k = "NODE_ENV"` all compiled
down to the literal string `"production"` too. There is no
bracket-notation escape hatch (see `docs/knowledge/testing-cypress.md`
for the original `NODE_ENV`-baking finding this extends).

**Fail-closed**: if `MOCK_GOOGLE_OAUTH_TEST=true` but the sentinel is
missing, `isMockGoogleOAuthTestEnabled()` throws at module load (server
startup / cold start) instead of silently skipping provider
registration — a misconfigured deploy fails loudly rather than quietly
running with a live account-takeover path.

**Unit vs. e2e coverage split**: `isMockGoogleOAuthTestEnabled()` lives
in its own dependency-free module (`lib/auth/mock-oauth-gate.ts`)
specifically so its fail-closed logic can be unit tested in isolation —
see `lib/auth/mock-oauth-gate.test.ts`. Importing `auth.ts` itself
directly in vitest is **not currently possible**: `next-auth`
transitively imports a `next/server` subpath that vitest's Vite-based
resolver cannot resolve outside Next.js's own bundler
(`Cannot find module '.../node_modules/next/server' imported from
next-auth/lib/env.js`). That means the `signIn()`/`jwt()` callback logic
in `auth.ts` — and the OAuth+MFA wiring end to end — can only be
exercised via e2e (`cypress/e2e/auth/mfa.cy.ts`), not vitest, until/unless
that logic is extracted into standalone modules the way the mock-OAuth
gate was.

---

## Reading the session on the server

Auth.js v5 replaces v4's `getServerSession(authOptions)` with a single
`auth()` helper exported from `@/auth`. Pattern:

```ts
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ...
}
```

In middleware (`proxy.ts` in Next.js 16), use the wrapper form:

```ts
import { auth } from '@/auth';

export const proxy = auth(async (req) => {
  // req.auth is the resolved Session (or null) — DB-backed for OAuth,
  // JWT-decoded for credentials. Transparent to the caller.
  if (!req.auth) return NextResponse.redirect(new URL('/login', req.url));
  // ...
});
```

Next.js 16 proxies always run on the Node.js runtime, so Prisma queries
from `auth()` work without extra config. (Don't add `runtime: 'nodejs'`
to the proxy `config` export — Next.js rejects it.)

---

## Why `user.password` is nullable

SSO-provisioned users have no password. The `password` column is
`String?` in `prisma/schema.prisma`, and the matching `required:` list
in `code_generator/json_schema.yaml` omits `password`.

The credentials `authorize()` in `auth.ts` rejects accounts where
`password === null`, returning the same "Invalid credentials" message
as a missing account. This avoids leaking that an email is registered
as an SSO account when a credentials sign-in is attempted.

If an SSO user later wants to *also* sign in with a password, an admin
(or a future self-serve flow) sets `password` to a bcrypt hash. No
other change is needed.

---

## Adding another OAuth provider

1. Install the provider (most ship inside `next-auth/providers/*`).
2. Add the provider id to `AuthProviderId` in `lib/site-config.ts` and
   include it in `siteConfig.auth.providers`.
3. In `auth.ts`'s `buildProviders()`, add a matching `if (siteConfig …
   includes && env vars present)` block that calls the provider's
   factory with `clientId` / `clientSecret` from env. The
   `isGoogleEnabled()` helper is currently only used to decide
   whether to register the Google provider; the session strategy is
   pinned to `"jwt"` for everyone (see "Session strategy"), so a new
   provider doesn't need a session-strategy hook.
4. Add the env vars to `.env.example` with the redirect URI documented.
5. Verify the provider sets `profile.email_verified` (or an
   equivalent) — the `signIn()` callback's verified-email guard is
   provider-specific. For providers that don't expose this, decide
   deliberately whether to trust the email or to require admin
   pre-provisioning.

---

## Out of scope

The following are explicitly out of scope for the current implementation:

- **Server-side revocation for credentials users**: Not implemented for sign-in itself — a stolen JWT cookie is self-contained and rotating `AUTH_SECRET` is the only global invalidation. Custom `adapter.createSession()` shim deferred. See `auth.ts` `authorize()`. (MFA-state revocation is handled separately — see "MFA on the OAuth path" below.)
- **MFA / TOTP**: Shipped in v1 (S5 phase 5a) for the credentials provider, opt-in per user. Shipped for the OAuth path too as of S8 (cmd_527) — see "MFA on the OAuth path" below. Admin-mandated MFA is still deferred.
- **Account linking UI**: Shipped in v1 (S7). `/setting/accounts` lists and connects/detaches OAuth providers; cross-email linking deferred. See `lib/account-link/`, `auth.ts`.
- **Audit-log table**: Not implemented. Auth events log to `console.info` only. Prisma model with role/permission hooks deferred.
- **Rate limiting on `/api/auth/*`**: Not implemented. Planned: Next.js proxy + Upstash Redis.
- **Per-tenant SSO (SAML)**: Not implemented. Would use SAML Jackson / WorkOS with per-tenant domain binding.
