# `db:create` — migrate:deploy or db:push, chosen by migration presence

`vercel-build` creates/updates the database schema through `npm run db:create`
(`scripts/db-create.sh`), not `migrate:deploy` directly:

| `prisma/migrations/` state                           | Command run      |
|------------------------------------------------------|------------------|
| at least one `prisma/migrations/*/migration.sql`     | `migrate:deploy` |
| missing, empty, or only `migration_lock.toml`        | `db:push`        |

## Why

`prisma/migrations/` is gitignored in app-generator (migrations are build
artifacts derived from the generated `schema.prisma`). A Vercel deploy of
app-generator itself therefore has no migration files, and `migrate:deploy`
would apply nothing — the deployed DB would have no tables. Generated apps that
ship migrations keep the `migrate:deploy` path unchanged.

## Notes

- Both branches go through `prisma.config.ts`, so `DIRECT_URL` handling (see
  `prisma-direct-vs-pooled-connection.md`) applies to `db:push` as well.
- `db:push` runs without `--accept-data-loss`: a destructive schema change fails
  the build instead of dropping data. Fix it manually (or switch to migrations).
- Do not mix the two on one database: a DB created by `db:push` has no
  `_prisma_migrations` history, so adding migrations later requires baselining
  (`prisma migrate resolve --applied <name>`) before `migrate:deploy` works.
- `build:full` (local production build) still calls `migrate:deploy` directly;
  it expects `dev:full` to have created migrations first (see README).
