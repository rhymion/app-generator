# SSO Authentication

The generated app supports SSO sign-in alongside email/password credentials.
Today only Google is wired up; the layering is designed so adding GitHub /
Microsoft / generic OIDC is a small, contained change.

MFA / TOTP is **not** in scope for this iteration — it would layer on top of
whichever provider performs first-factor authentication and is tracked
separately.

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
│ auth.ts                      │  buildProviders()           — server gate
│   if siteConfig allows       │  PrismaAdapter(prisma)      — persists
│   && env vars present        │     User / Account / Session /
│     → register provider      │     VerificationToken rows
│                              │  session: { strategy: 'jwt' }
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ NextAuth                     │  Adapter creates User + Account on first
│   - OAuth via adapter        │     OAuth sign-in → events.createUser
│   - Credentials direct       │     mirrors to user_account (shared id).
│                              │  Credentials never touches the adapter.
└──────────────────────────────┘
```

Two NextAuth-related tables are populated today (`User`, `Account`) and two
are reserved for later (`Session` is unused on JWT strategy;
`VerificationToken` lights up if/when we add a magic-link provider). The
shape of all four is dictated by `@next-auth/prisma-adapter` and lives at
the bottom of `prisma/schema.prisma` — PascalCase model names, a deliberate
exception to the rest of the schema's snake_case convention.

Two gates have to agree before a provider button works:

1. **UI gate** — `siteConfig.auth.providers` in `lib/site-config.ts`.
   The login page only renders buttons for providers listed here.
2. **Server gate** — required env vars (e.g. `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` for Google). `auth.ts` skips registering the
   provider with NextAuth if either is missing, so the OAuth callback URL
   would 404 even if a button somehow leaked through.

If a provider is listed in `siteConfig` but its env vars aren't set, clicking
the button reaches `/api/auth/signin/google` with no `google` provider
registered — NextAuth returns an error. Keep the two in sync, or use a
deployment check that asserts both are present together.

---

## Google — turning it on

1. Create credentials at the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Add `${NEXTAUTH_URL}/api/auth/callback/google` (e.g.
   `http://localhost:3000/api/auth/callback/google` in dev) to the authorized
   redirect URIs.
2. Set env vars (see `.env.example`):
   ```bash
   GOOGLE_CLIENT_ID="..."
   GOOGLE_CLIENT_SECRET="..."
   ```
3. Make sure `'google'` is in `siteConfig.auth.providers`. It is by default.
4. Restart the dev server.

To **disable** Google without unsetting the env vars (e.g. on a tenant that
shouldn't see the button), remove `'google'` from `siteConfig.auth.providers`.

To **ship an SSO-only deployment**, remove `'credentials'` from
`siteConfig.auth.providers`. The email/password form, `Register` link, and
credentials authorize() are all gated on that entry. The `Register` route
still exists code-wise but is unreachable from the login UI.

---

## First-time SSO sign-in (auto-provisioning)

On the first Google sign-in for a given email:

1. `signIn()` callback runs **before** the adapter writes anything.
   It enforces:
   - `profile.email_verified !== false` (Google sets this for all completed
     accounts; an explicit `false` is rejected).
   - `siteConfig.auth.allowedDomains` — if non-empty, the email's `@domain`
     must be on the list (case-insensitive). Empty list = allow all.
   - The **credentials↔OAuth collision rule**: if a `user_account` row exists
     for this email but no `User` row shares its id (i.e. a credentials-only
     user is trying to SSO with the same address), the sign-in is rejected
     with reason `email_in_use_by_credentials`. Letting the adapter run
     would create a fresh `User` row and then explode on the
     `@unique(email)` constraint when `events.createUser` mirrors it back
     into `user_account`. Admin reconciliation step: pre-populate matching
     `User` and `Account` rows for the existing account.
2. If `signIn()` returns true, NextAuth's PrismaAdapter creates the `User`
   row (`prisma.user.create`) and the `Account` row recording
   `(provider, providerAccountId, refresh_token, access_token, …)`.
3. `events.createUser({ user })` fires. We mirror to `user_account` with
   the **same id** as the new `User` row so `session.user.id` continues to
   address `user_account` directly:
   - `email`, `name`, `avatar` copied from the User row.
   - `password = null` (column was made nullable for this — see schema note
     below).
   - `creator_id` / `updater_id` self-reference the new id, the same
     bootstrap pattern as `/api/auth/register`.
4. `events.signIn` fires, emitting a structured `[auth:signIn]` JSON line
   with `isNewUser: true` (it's `null` for credentials sign-ins because
   credentials never goes through the adapter).

No role is assigned. An admin grants roles after the user appears in the
`user_account` table. This is intentional — auto-granting roles via SSO is
the kind of decision that should be explicit per deployment.

### Returning OAuth sign-in

The adapter finds the existing `Account` row by
`(provider, providerAccountId)`, reads its `userId`, and reuses the same
`User`. `signIn()` runs but doesn't trip the collision rule because a User
row already exists for the email. No `createUser` event.

This is the **identity-stability win** of moving to the adapter: if a
Google user changes their primary email, the `providerAccountId` is the
same so they stay the same `User` (and therefore the same `user_account`).
The previous (no-adapter) implementation matched by email, so the same
event would have created a brand-new domain user.

---

## Why `user_account.password` is nullable

SSO-provisioned users have no password. The `password` column was changed
from `String` (required) to `String?` in `prisma/schema.prisma`, and the
matching `required:` list in `code_generator/json_schema.yaml` was updated
to omit `password`.

The credentials `authorize()` in `auth.ts` rejects accounts where
`password === null`, returning the same "Invalid credentials" message as a
missing account. This avoids leaking that an email is registered as an SSO
account when a credentials sign-in is attempted.

If an SSO user later wants to *also* sign in with a password, an admin
(or a future self-serve flow) sets `password` to a bcrypt hash. No other
change is needed.

---

## Adding another OAuth provider

1. Install the NextAuth provider (most ship inside `next-auth/providers/*`).
2. Add the provider id to `AuthProviderId` in `lib/site-config.ts` and
   include it in `siteConfig.auth.providers`.
3. In `auth.ts`'s `buildProviders()`, add a matching `if (siteConfig …
   includes && env vars present)` block that calls the provider's factory
   with `clientId`/`clientSecret` from env.
4. Add the env vars to `.env.example` with the redirect URI documented.
5. Verify the provider sets `profile.email_verified` (or an equivalent) —
   the `signIn()` callback's verified-email guard is provider-specific.
   For providers that don't expose this, decide deliberately whether to
   trust the email or to require admin pre-provisioning.

---

## Out of scope, for next time

- **Database session strategy (server-side revocation)** — NextAuth v4
  ties the Credentials provider to JWT sessions; switching to
  `session.strategy = 'database'` silently breaks credentials sign-in.
  The migration path is **Auth.js v5**, which natively supports mixed
  strategies (Credentials on JWT, OAuth on DB). The PrismaAdapter is
  already in place, so when v5 lands the change is `session.strategy +
  Credentials adjustments`, not a schema migration.
- **MFA / TOTP** — second factor on top of either provider. NextAuth doesn't
  ship this; the typical pattern is a custom `step` in the credentials flow
  or a separate gate after `session.user.id` is known.
- **Account linking UI** — letting a signed-in user attach an additional
  OAuth provider to their existing account. The plumbing is there (one User
  row can own multiple Account rows), but there's no user-facing flow yet.
- **Audit-log table** — `events.signIn` / `signOut` / `createUser` currently
  emit structured `console.info` lines. A real audit-log Prisma model with
  hooks into role/permission CRUD is its own piece of work.
- **Rate limiting on `/api/auth/*`** — no middleware today. Realistic plan:
  Next.js middleware + Upstash Redis (or in-memory for dev).
- **Per-tenant SSO (SAML)** — would use SAML Jackson / WorkOS rather than
  rolling SAML ourselves, with per-tenant domain binding.
