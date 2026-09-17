# Business date container — migration reference

> This model was added to `prisma/schema.prisma` without a committed migration (this repo's own
> `prisma/migrations/` is gitignored — see `docs/knowledge/migration-guide.md`: migrations are
> tracked by each consumer/wrapper repo, not by this generator repo itself). This doc carries
> forward the one migration detail that cannot be expressed in `schema.prisma` at all, for whoever
> next runs `prisma migrate dev`/`migrate deploy` against a real database (this repo's own local
> dev flow, or a consumer wrapper repo picking up this base-schema change): the partial unique
> index that enforces "at most one tenant-wide default row." Re-verify the model still looks like
> this before applying, since it may have changed since this doc was written.

## Why this can't just be `@@unique([organization_id])`

`organization_id` is nullable — a row with `organization_id = NULL` is the tenant-wide default, applied to any data
with no organization or whose organization has no `app_setting` row of its own. `@@unique([organization_id])`
(already declared in `schema.prisma`) correctly limits each **organization** to at most one row,
because Postgres compares actual non-null values normally. It does **not** limit the number of
`organization_id IS NULL` rows, because Postgres's default unique-constraint semantics treat every NULL as
distinct from every other NULL — an unlimited number of default rows could otherwise be created.

## What was tried and empirically failed

Prisma 7.10 ships an undocumented `partialIndexes` preview feature that adds a `where:` argument to
`@@unique`/`@@index` (found by probing the schema validator's own error messages, not from any
changelog). Declaring:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../app/generated/prisma"
  previewFeatures = ["partialIndexes"]
}

model app_setting {
  // ...
  @@unique([organization_id], where: { organization_id: null })
}
```

validates and lowers to `CREATE UNIQUE INDEX ... ON app_setting(organization_id) WHERE organization_id IS NULL`. This
was applied to a real Postgres 16 test database and then disproved empirically: inserting a second
`organization_id IS NULL` row succeeded when it should have been rejected, because the index still compares
NULL to NULL, which Postgres never treats as a conflict, partial or not. Prisma has no `nulls:
NotDistinct` argument to opt into Postgres 15+'s `NULLS NOT DISTINCT` behavior (the validator
returns "No such argument" for it), so this cannot be fixed from inside the schema DSL as of this
Prisma version. This preview feature was not kept in the committed schema.

## The fix — a unique index on a constant expression

The standard workaround: index a non-null constant expression instead of the nullable column,
filtered by the same predicate, so uniqueness is compared between real (non-null) values instead of
NULLs. Prisma's schema DSL has no way to declare an index on an expression (only on model fields),
so this must be raw SQL, added by hand to whichever migration first introduces `app_setting`:

```sql
CREATE UNIQUE INDEX app_setting_default_row_unique
  ON app_setting ((true))
  WHERE organization_id IS NULL;
```

### Empirical verification (2026-09-17, isolated worktree test database, Postgres 16)

With the index applied:

```
INSERT INTO app_setting (id, organization_id, business_date, updated_at, creator_id, updater_id)
VALUES ('as1', NULL, '2026-09-17', now(), 'u1', 'u1');
-- INSERT 0 1

INSERT INTO app_setting (id, organization_id, business_date, updated_at, creator_id, updater_id)
VALUES ('as2', NULL, '2026-09-18', now(), 'u1', 'u1');
-- ERROR:  duplicate key value violates unique constraint "app_setting_default_row_unique"
-- DETAIL:  Key ((true))=(t) already exists.
```

The first `organization_id IS NULL` insert succeeds; the second is rejected. A per-org row (`organization_id` set)
is unaffected — inserting two rows for the same `organization_id` fails against the existing
`app_setting_organization_id_key` unique constraint instead, as expected.

A `prisma db push` re-run after adding this raw index left it untouched (not dropped as
undeclared drift) — Prisma's diff only pushes forward what `schema.prisma` itself declares, it does
not delete database objects with no schema representation. This index is durable across future
`db push`/`migrate dev` runs without needing to be declared in `schema.prisma`.

## When to apply

This migration cadence is deliberate — migrations are cut at develop-merge time, not per individual
task (see `docs/knowledge/migration-guide.md`), so this SQL is **not** included in this task's own
commit. Add it as part of whichever migration first creates the `app_setting` table (alongside the
`CREATE TABLE`/`CREATE UNIQUE INDEX app_setting_organization_id_key`/FK statements `prisma migrate dev`
generates automatically from the schema).

## `resetTestDatabase()` does not know about this model

`cypress/support/db-helpers.ts`'s `resetTestDatabase()` deletion order is generated from
`code_generator/json_schema.yaml` definitions (`generators_test.py`'s `db_helpers_context`), not
from `prisma/schema.prisma` directly. `app_setting` is a hand-written base-schema model with no
`json_schema.yaml` entry, so it is invisible to that ordering logic. Today this is harmless because
nothing creates `app_setting` rows (no seed step, no read/write path exists yet), so
`prisma.user.deleteMany()` never has a dependent row to conflict with. **Once a future task adds a
real write path** (the read function, admin UI, or scheduled-task wiring this container
deliberately excludes), `resetTestDatabase()`'s hardcoded list must add an
`await prisma.app_setting.deleteMany();` step before the `user`-deletion level, or Cypress test
resets will fail with `app_setting_creator_id_fkey`/`app_setting_updater_id_fkey` violations the
moment a real `app_setting` row exists in a test run.
