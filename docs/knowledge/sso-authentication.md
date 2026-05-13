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
│ lib/site-config.ts           │  siteConfig.auth.providers — UI gate
│   auth.providers:            │  (decides which buttons are rendered)
│     ['credentials','google'] │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ auth.ts                      │  buildProviders() — server gate
│   if siteConfig allows       │  (decides which providers NextAuth knows)
│   && env vars present        │
│     → register provider      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ NextAuth callbacks           │  signIn() upserts user_account by email
│   - OAuth: derive user.id    │  jwt()/session() carry the local id
│   - Credentials: pass-through│
└──────────────────────────────┘
```

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

1. `signIn()` callback receives `user` + `account` + `profile` from NextAuth.
2. We require `profile.email_verified === true` (Google sets this for all
   completed accounts). If it's explicitly `false`, the sign-in is rejected
   — without verified email we can't safely match-or-create by email.
3. If a `user_account` with that email already exists, we link by setting
   `user.id` to that row's id (so the JWT carries the local id, not the
   OAuth subject). Existing credentials users can therefore add SSO without
   losing their record.
4. If no `user_account` exists, we create one with:
   - `email` from the IdP
   - `name` from `profile.name` (or the email if name is missing)
   - `avatar` from `profile.picture`
   - `password = null` (column was made nullable for this — see schema note
     below)
   - `creator_id` and `updater_id` self-referencing the new row's id, the
     same bootstrap pattern as `/api/auth/register`.

No role is assigned. An admin grants roles after the user appears in the
`user_account` table. This is intentional — auto-granting roles via SSO is
the kind of decision that should be explicit per deployment.

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

- **MFA / TOTP** — second factor on top of either provider. NextAuth doesn't
  ship this; the typical pattern is a custom `step` in the credentials flow
  or a separate gate after `session.user.id` is known.
- **Account linking UI** — letting a signed-in user attach an additional
  OAuth provider to their existing account. Today, linking is implicit via
  email match.
- **`@next-auth/prisma-adapter`** — would persist `Account` / `Session` /
  `VerificationToken` rows instead of using JWT-only sessions. Worth
  revisiting when (a) we want to revoke sessions server-side, or (b) a user
  has multiple OAuth providers attached.
