# Unauthenticated Page Redirect (cmd_525)

`proxy.ts` (Next.js 16's rename of `middleware.ts`) sends unauthenticated
requests for protected *pages* to `/login` before the page ever renders,
and sends the user back to where they started once they sign in. This is
the mechanism referenced as "resolved" in `docs/knowledge/error-message-framework.md`'s
U1/U2 rows and OQ-4.

## What it does

For every request that isn't under `/api/*`, isn't a static file, and isn't
one of the public paths below, `proxy.ts` checks `req.auth` (resolved by
Auth.js v5's `auth()` wrapper — JWT-decoded for credentials sign-in, no DB
hit):

- **Authenticated** (`req.auth` truthy): request proceeds normally.
- **Unauthenticated**: `307` redirect to `/{locale}/login?redirect=<original-path>`.

This applies to both `GET` (page loads) and `POST` (Server Action
submissions land on the same page pathname) — an unauthenticated Server
Action call is redirected the same way an unauthenticated page load is,
before the action handler or any `lib/authz.ts` check runs.

## What it does NOT touch

- **`/api/*` routes** are excluded from `proxy.ts`'s route matcher
  entirely (`config.matcher` explicitly excludes `api`, with a narrow
  carve-out for `/api/auth/:path*` only). They keep returning their own
  JSON `401`/`404` via `lib/api-auth.ts`, exactly as before this change —
  a client expecting JSON never receives an HTML redirect.
- **Public paths** — matched after stripping any locale prefix — never
  redirect:
  - `/login`, `/register` (the auth pages themselves)
  - `/docs` (auto-generated entity documentation)
  - `/legal` (Terms of Service, Privacy Policy — see `legal-documents.md`)
  - static assets and Next.js internals (`_next/*`, `_vercel/*`, any path
    with a file extension) — excluded by the route matcher's
    `(?!api|_next|_vercel|.*\..*)` negative lookahead
- **Already-authenticated requests** to any path — proxy passes them
  straight through to the next-intl locale middleware.

Because the exclusion list above is closed and self-consistent (you can
never reach `/login` and get redirected to `/login` again), there is no
redirect loop. Verified in `cypress/e2e/auth_redirect.cy.ts` and by direct
`curl` request against each excluded path (single request, no `Location`
header on any of them).

## Redirect-back (`?redirect=`)

Before cmd_525, an unauthenticated visit to any protected page always
landed the user on the login page with `/` as the only post-login
destination — mid-task navigation was lost. `proxy.ts` now appends the
originally-requested path (and its query string) as `?redirect=` on the
`/login` URL it builds, and `app/[locale]/login/page.tsx` reads it back
via `useSearchParams()` to decide where to send the user after a
successful sign-in (both credentials and Google OAuth).

## Open-redirect defense

The `redirect` query param is attacker-visible — a malicious link could
set `?redirect=https://evil.example.com` and rely on the victim signing in
normally, expecting to land off-site afterward. `lib/auth/safe-redirect.ts`
exports `safeRedirectPath()`, used on the *read* side (the login page) to
validate the param before ever assigning it to `window.location.href`:

- Only values starting with a single `/` are considered.
- The candidate is resolved with `new URL(value, <fixed-invalid-base>)`
  and rejected unless the resolved origin still matches that fixed base —
  this catches absolute URLs (`https://evil.com`), protocol-relative URLs
  (`//evil.com`), and browser backslash-normalization tricks
  (`/\evil.com`, which WHATWG URL parsing treats the same as `//evil.com`)
  in one check, rather than a growing list of string patterns.
- Anything rejected falls back to `/` — the same default as before
  cmd_525 existed.

`proxy.ts` itself also runs the requested path through `safeRedirectPath()`
before writing it into the `/login` URL, for defense in depth — though
that value always originates server-side from `req.nextUrl`, never from
attacker input, so the read-side check on the login page is the actual
security boundary.

## Files

| File | Role |
|---|---|
| `proxy.ts` | Route matcher, public-path list, unauthenticated redirect + `?redirect=` construction |
| `app/[locale]/login/page.tsx` | Reads `?redirect=`, validates it, navigates there post-login |
| `lib/auth/safe-redirect.ts` | `safeRedirectPath()` — shared same-origin validation, unit-tested in `safe-redirect.test.ts` |
| `cypress/e2e/auth_redirect.cy.ts` | End-to-end coverage: page redirect, API unaffected, no loop, redirect-back, open-redirect rejection |

## Related

- `docs/knowledge/authentication.md` — Auth.js v5 session strategy and the
  `auth()` wrapper form used by `proxy.ts`.
- `docs/knowledge/error-message-framework.md` — the U1/U2 rows this
  mechanism makes unreachable, and OQ-4's resolution.
- `docs/knowledge/legal-documents.md` — why `/legal` is a public path.
- `docs/knowledge/i18n-locale-routing.md` — how the locale prefix is
  stripped/restored around the auth check.
