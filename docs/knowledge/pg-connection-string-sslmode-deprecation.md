# Why `db:seed-baseline` warned about SSL modes, and why pinning `sslmode=verify-full` fixes it for good

## The warning

Running `db:seed-baseline` against a Vercel/Neon database printed:

```
(node:...) Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and
'verify-ca' are treated as aliases for 'verify-full'. In the next major
version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt
standard libpq semantics, which have weaker security guarantees.
```

## Where it comes from

Not from first-party code — a repo-wide grep for `sslmode|ssl:|rejectUnauthorized|NODE_TLS`
across `.ts`/`.js` sources returns zero hits. The warning is emitted by
`pg-connection-string` (the connection-string parser `pg`/`@prisma/adapter-pg`
depend on transitively), specifically `deprecatedSslModeWarning()` in
`node_modules/pg-connection-string/index.js`. It fires once per process
whenever a parsed connection string's `sslmode` is `prefer`, `require`, or
`verify-ca` (not `verify-full`, `disable`, or `no-verify`).

Neon's connection strings embed `sslmode=require&channel_binding=require` by
default. That single query param is the trigger — nothing this repo's code
sets explicitly.

Confirmed empirically (`pg-connection-string@2.11.0`, pinned by `pg@8.18.0`
in `package-lock.json`): parsing a Neon-shaped DSN with `sslmode=require`
produces `ssl: {}` (i.e. no explicit `rejectUnauthorized`/`checkServerIdentity`
override — Node's TLS default, full certificate verification, applies).
Parsing the *same* DSN with `sslmode=verify-full` instead produces the
byte-identical `ssl: {}`. The two modes are not just similarly secure today —
they compile to the same object, so there is no code path where switching
between them changes runtime TLS behavior right now.

## Two entry points affected

`db:seed-baseline` (`scripts/seed-baseline.ts`) and the app's runtime Prisma
client (`lib/prisma.ts`) both build a `PrismaPg` adapter from
`DIRECT_URL`/`DATABASE_URL`, so both go through this same parser. `prisma
migrate deploy` (the `vercel-build` step, `prisma.config.ts`) does **not** —
Prisma's migration engine is a separate Rust-based connector that never loads
the `pg-connection-string` npm package (confirmed: no reference to it in the
installed `prisma`/`@prisma/config` CLI bundles). So this warning, and the
future behavior change below, is scoped to the two Node `pg`-driver call
sites, not to migrations.

## Impact, now and after the next major version

- **Today**: none. As shown above, `require`/`prefer`/`verify-ca` and
  `verify-full` produce an identical `ssl` config in this version — the
  warning is purely advance notice, not a sign of an active weakness.
- **After `pg-connection-string` v3.0.0 / `pg` v9.0.0**: `require` is
  documented to switch to standard libpq semantics — under real libpq,
  `sslmode=require` only guarantees an encrypted channel, not certificate
  verification. That *would* be a real regression (silently weaker TLS
  verification against Neon) if the connection strings still say `require`
  at that point. `verify-full` is unaffected by the change — libpq's
  `verify-full` already means strict verification, and the deprecation
  message itself names `verify-full` as the explicit spelling that preserves
  today's behavior across the bump.

## The fix

`lib/db-url.ts` exports `pinSslModeVerifyFull(rawUrl)`, a pure string
transform: if `sslmode` is `prefer`, `require`, or `verify-ca`, rewrite it to
`verify-full`; otherwise return the URL unchanged (a no-op for local/CI
Postgres URLs, which have no `sslmode` param at all). Both `scripts/seed-baseline.ts`
and `lib/prisma.ts` apply it to the connection string right before
constructing the `PrismaPg` adapter.

This was **not** fixed by suppressing the warning (`NODE_NO_WARNINGS` or
similar) — that would hide the future behavior change instead of freezing
today's safe behavior, which is what was actually asked for.

Verified live (no real Neon/Vercel connection involved — a real TCP attempt
to a closed local port is enough to force `pg`'s connection-string parser to
run, which is where the warning fires):

```
$ node -e "
  const { Pool } = require('pg');
  const p = new Pool({ connectionString: 'postgresql://user:pass@127.0.0.1:1/db?sslmode=require&channel_binding=require', connectionTimeoutMillis: 1000 });
  p.connect().catch(e => console.log('connect failed as expected:', e.code || e.message));
"
(node:...) Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', ...
connect failed as expected: ECONNREFUSED
```

versus, with the same DSN passed through `pinSslModeVerifyFull` first:

```
fixed URL sslmode: verify-full
connect failed as expected: ECONNREFUSED
```

— no warning, identical connection outcome.
