# Why migrations need a direct connection, separate from the app's pooled one

## The problem (cmd_657)

On Vercel, `DATABASE_URL` is Neon's **pooled** endpoint (PgBouncer, transaction
mode) — see `docs/knowledge/vercel-region-alignment.md` for the region story
behind that same URL. The app's runtime queries go through that pooled
connection via `lib/prisma.ts` (`PrismaPg` adapter), which is fine: individual
queries are short-lived and don't depend on session state surviving across
statements.

`vercel-build` also runs `migrate:deploy` through the same `DATABASE_URL`
(via `prisma.config.ts`'s `datasource.url`). That's the part that isn't fine.
Prisma's migration engine takes a `pg_advisory_lock` and applies DDL inside a
session-scoped transaction, expecting every statement in that sequence to
land on the *same* backend connection. A transaction-mode PgBouncer pooler —
Neon's default, and what fronts `DATABASE_URL` here — does not guarantee
that: different transactions can be routed to different backend connections.
Nothing has broken from this yet (migration history here is short, and
`seed-tenant`'s plain sequential `INSERT`s never depended on session-scoped
locking in the first place — that a seed script runs fine over a pooler says
nothing about whether a lock-taking migration will), but the risk grows with
every migration added.

GCP Cloud Run never had this problem: its `DATABASE_URL` is a direct Cloud
SQL unix socket, no pooler in front of it (see `docs/knowledge/manual-ops.md`
§1's "direct socket is the production DB path" decision). Local dev and CI
are the same — a bare local Postgres, no pooler. **DIRECT_URL only exists to
give Vercel/Neon what GCP and local/CI already have by construction.**

## The fix

`prisma.config.ts`'s `datasource.url` — read only by the Prisma CLI
(`migrate deploy`, `migrate dev`, `db push`, `studio`; never by the running
app, which reads `DATABASE_URL` itself in `lib/prisma.ts`, independently of
this file) — now prefers `DIRECT_URL` when set, falling back to
`DATABASE_URL` otherwise:

```ts
const directMigrationUrl = process.env.DIRECT_URL
// ...
datasource: {
  url: directMigrationUrl || process.env.DATABASE_URL,
  shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
},
```

This is deliberately **not** Prisma's classic `directUrl` datasource field —
that field does not exist in this project's Prisma config API. Confirmed
empirically (2026-08-12): the installed `@prisma/config` (7.9.1) types
`Datasource` as `{ url?: string; shadowDatabaseUrl?: string; }` only; adding
a `directUrl` key to `defineConfig({ datasource: {...} })` fails
`tsc --noEmit` with `TS2353: Object literal may only specify known
properties, and 'directUrl' does not exist in type ...`. The classic
schema.prisma `directUrl` datasource field is likewise unavailable here:
Prisma 7's `schema.prisma` `datasource db` block no longer carries a `url`
at all (see `datasource db { provider = "postgresql" }` in
`prisma/schema.prisma` — connection strings live only in `prisma.config.ts`
now). The two connection endpoints are achieved here by having
`prisma.config.ts` (CLI-only) and `lib/prisma.ts` (app runtime-only) each
resolve their own URL independently, not by a single `directUrl` field.

## Why this can't silently regress

Falling back to `DATABASE_URL` whenever `DIRECT_URL` is unset is correct on
GCP/local/CI (nothing changes there — there was never a pooler to route
around). But the same silent fallback on Vercel, if someone forgot to set
`DIRECT_URL` there, would look identical to "fixed" while migrations kept
running through the pooled connection — the exact deviation this change
exists to close, now invisible behind a green gate.

`prisma.config.ts` guards against that using Vercel's own auto-injected
`VERCEL` system env var (set at build and runtime on that platform only —
https://vercel.com/docs/environment-variables/system-environment-variables):
if `VERCEL` is set and `DIRECT_URL` is not, config loading throws instead of
silently falling back. Everywhere else (`VERCEL` unset), the fallback is
silent and correct, because there's nothing to route around.

## Setting `DIRECT_URL` on Vercel (superseded — see subtask_657b)

**This section originally described a manual, dashboard-only step. That is
superseded (cmd_657 follow-up, 2026-08-12).** All Vercel setup for this
project has always gone through the consumer repo's (`app-template`)
`scripts/vercel-setup.sh` / `scripts/vercel-env.sh` — the same single place
`DATABASE_URL`, `AUTH_SECRET`, `REDIS_URL`, and every other Vercel env var
are already set. Splitting `DIRECT_URL` out into a separate manual dashboard
step would put configuration in two places instead of one.

Concretely, `app-template/scripts/vercel-env.sh`'s `vercel_env_inject()` now
also injects `DIRECT_URL`, sourced from `DATABASE_URL_UNPOOLED_PROD` /
`DATABASE_URL_UNPOOLED_STAGING` — values `vercel-setup.sh`'s
`get_neon_connection_strings()` already fetches from Neon and persists to
`.env.production.local` for both branches. Nothing new needs to be fetched
from Neon; the unpooled values were already being retrieved and just weren't
being forwarded to Vercel. Running (or re-running — idempotent)
`app-template/scripts/vercel-setup.sh` sets `DIRECT_URL` on both Production
and Preview alongside `DATABASE_URL`. See `app-template`'s
`docs/vercel-automation-design.md` for the consumer-side detail.

This is still a production Vercel deploy configuration change and
`DIRECT_URL`'s value is still a secret — it must never be typed into an
inbox, report, PR, or commit; the script is the only thing that ever
touches the value.

No application code change is needed beyond this — `prisma.config.ts` already
picks up `DIRECT_URL` once it's set.
