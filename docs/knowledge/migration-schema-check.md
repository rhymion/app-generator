# Migration / schema match check

`scripts/check-migrations-match-schema.sh` verifies that a consumer's migration files
build the database that `prisma/schema.prisma` describes.

## Why it exists

Test databases are built with `db:push`, which reads the schema and ignores the
migration files. A deployed database is built with `prisma migrate deploy`, which
applies only the migration files. A model that is in the schema but that no migration
creates therefore works in every test and fails on the first deployed request. The
generator adds models to `prisma/schema.prisma` on every `generate-code` (for example
`scheduled_task_run` and the `ScheduledTaskRunStatus` enum), and it does not write the
migration for them (see "Consumer migration" in `scheduled-task-operations.md`), so
the consumer's migrations can fall behind without any test noticing.

## What it does

On an empty scratch database it runs `prisma migrate deploy`, then
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
The check fails when the printed SQL is not empty, and prints that SQL: it is the
statement a missing migration would have to contain. The scratch database is dropped
at the end.

Run it from the app root, after `prj:sync` and `generate-code`:

```bash
npm run sync && npm run generate-code        # consumer root
cd app-generator && bash scripts/check-migrations-match-schema.sh
```

`prj:sync` alone is not enough: it resets the schema to the hand-written part, and the
generator-added models exist only after `generate-code`. The script refuses to run
when `prisma/migrations` or `code_generator/.generated/json_schema.yaml` is absent.

Exit code: `0` the migrations match, `1` they differ (or do not apply to an empty
database), `2` a precondition, the database guard or the tooling failed and nothing
was verified.

## When to run it

Migrations are written when a change is merged to `develop`, so a feature branch whose
schema is ahead of its migrations is normal and is not a failure to fix on the branch.
Run the check when preparing a `develop` merge or a deployment: it is the last step
before the migrations are relied on. It is not part of the per-commit gate and no CI
job runs it.

## The throwaway-database guard

The script creates and drops a database, so it only talks to a local server:

- The server comes from `MIGRATION_CHECK_DATABASE_URL`, else `DATABASE_URL` in
  `MIGRATION_CHECK_ENV_FILE` (default `.env.test`). Only host, port and credentials
  are used; the database is always a new `migcheck_*` one.
- The host must be `localhost`, `127.0.0.1` or `::1`. Any other host (a Neon endpoint,
  a private address, a name that merely starts with `localhost`) is refused with exit
  code `2` before anything connects.
- Connection strings and the password reach `psql` and the Prisma CLI through
  environment variables only (`PG*`, `DATABASE_URL`, `DIRECT_URL`), never as arguments.
  The script overrides `DIRECT_URL` as well, because `prisma.config.ts` prefers it.

## Known differences: the exceptions file

A difference that stays on purpose (for example a table the migrations still create
although its model left the schema, kept until a drop migration is approved) is listed
in `prisma/migration-schema-exceptions.txt`, or in the file given with `--exceptions`.
A consumer keeps it at `prj/prisma/migration-schema-exceptions.txt`; `prj:sync` copies
it. The default is no file, which means no exceptions.

One rule per line; blank lines and lines starting with `#` are ignored. A rule is the
beginning of a SQL statement as the diff prints it (whitespace collapsed, case
significant), and a statement is covered when it starts with a rule:

```text
# orphan table, dropped once a drop migration is approved
ALTER TABLE "parent_only" DROP CONSTRAINT
DROP TABLE "parent_only"
```

`scripts/migration-schema-exceptions.example.txt` carries the same example. A rule that
matches no statement is reported as stale so that finished exceptions get removed.
Every exception is a statement the check no longer protects; give each one a comment
that says why and when it goes.

## What it does not catch

- Anything Prisma does not model: triggers, functions, roles, grants, extensions, and
  raw SQL (`prisma/sql`, hand-written statements inside a migration). The diff cannot
  see them.
- Failures that depend on existing data, such as a `NOT NULL` column added to a table
  with rows or a unique index over duplicate values. The scratch database is empty.
- Whether a migration is right for a database in an older state than the empty one.
- A migration that matches the schema but is destructive on a populated database.

## Tests

`code_generator/tests/test_check_migrations_match_schema.py` runs the script with stub
`psql` and `prisma` programs: an empty diff passes, a missing model fails, the
exceptions file is respected and does not hide other differences, non-local URLs are
refused before any connection, and the password never appears in an argument list.
