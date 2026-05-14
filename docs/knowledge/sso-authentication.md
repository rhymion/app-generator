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
│   if siteConfig allows       │  buildAdapter() wraps
│   && env vars present        │     PrismaAdapter(prisma) — overrides
│     → register provider      │     createUser to fill domain-required
│                              │     fields (name, creator_id, updater_id)
│                              │  session: { strategy: 'jwt' }
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ NextAuth                     │  Adapter writes the `user` row directly
│   - OAuth via adapter        │     on first OAuth sign-in. `Account` row
│   - Credentials direct       │     records (provider, providerAccountId).
│                              │  Credentials never touches the adapter.
└──────────────────────────────┘
```

PrismaAdapter expects to read/write `prisma.user`, `prisma.account`,
`prisma.session`, `prisma.verificationToken`. The schema's domain `user`
table satisfies the first one — Prisma derives the client name by
lower-casing the model name, so `model user` exposes `prisma.user` exactly
as the adapter requires. The other three are PascalCase NextAuth-only
tables at the bottom of `prisma/schema.prisma`, a deliberate exception to
the snake_case convention. `Account` is populated on every OAuth sign-in;
`Session` is unused on JWT strategy; `VerificationToken` lights up if/when
a magic-link provider is added.

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
   - The **credentials↔OAuth collision rule**: if a `user` row already
     exists for this email with `password !== null`, that account was
     created via `/register`. SSO sign-in is rejected with reason
     `email_in_use_by_credentials`. Without this guard, the adapter would
     attempt to create a new `user` row and hit the `@unique(email)`
     constraint — same outcome, less explicit. Admin reconciliation step:
     pre-populate a matching `Account` row to link the existing user to
     the OAuth identity.
2. If `signIn()` returns true, `buildAdapter().createUser()` (our wrapper
   around PrismaAdapter) inserts the `user` row with: pre-generated cuid,
   `email`, `name = profile.name ?? email`, `emailVerified`, `image`, and
   self-referencing `creator_id`/`updater_id` matching the new id. The
   wrapper exists because the default PrismaAdapter only writes the
   NextAuth-shape fields, but our `user` table requires non-null `name`
   plus the audit-bootstrap pattern shared with `/api/auth/register`.
3. The adapter then writes the `Account` row recording
   `(provider, providerAccountId, refresh_token, access_token, …)`.
4. `events.signIn` fires, emitting a structured `[auth:signIn]` JSON line
   with `isNewUser: true` (it's `null` for credentials sign-ins because
   credentials never goes through the adapter).

No role is assigned. An admin grants roles after the user appears in the
`user` table. This is intentional — auto-granting roles via SSO is the
kind of decision that should be explicit per deployment.

### Returning OAuth sign-in

The adapter finds the existing `Account` row by
`(provider, providerAccountId)`, reads its `userId`, and reuses the same
`user` row. `signIn()` runs but doesn't trip the collision rule because
the matching `user` row was created via SSO (`password === null`). No
`createUser` is called on the adapter.

This is the **identity-stability win** of the adapter: if a Google user
changes their primary email, the `providerAccountId` is the same so they
stay the same `user` row. The previous (no-adapter) implementation matched
by email, so the same event would have created a brand-new domain user.

---

## Why `user.password` is nullable

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
