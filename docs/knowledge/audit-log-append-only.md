# `audit_log` is append-only

A row in `audit_log` cannot be changed or deleted through any ordinary path, and a change made with elevated database
privileges is detectable afterwards. The rule that makes this possible: **`audit_log.metadata` never contains personal
data.** No code path then needs to update a row, so the table has no exception.

This protects what was recorded. It does not guarantee that every event is recorded: `recordAuditEvent` is best-effort for
callers outside a transaction (auth events) and swallows a write failure. Do not describe the log as complete.

## Layers

| Layer | Mechanism | Where |
|---|---|---|
| Application | Prisma Client extension rejecting `update*`, `upsert`, `delete*` on `audit_log` and `audit_log_digest` | `lib/audit-log-integrity/guard.ts`, applied in `lib/prisma.ts` |
| Database, rows | `BEFORE UPDATE OR DELETE` row trigger that always raises | `prisma/sql/audit_log_append_only.sql` |
| Database, privileges | The application role has `SELECT` and `INSERT` only: not the owner, no `UPDATE`, `DELETE` or `TRUNCATE` | `prisma/sql/audit_log_app_role.sql` (template) |
| Detection | Chained SHA-256 digest per closed period, kept in `audit_log_digest` and in storage outside the database | `lib/audit-log-integrity/digest.ts` |

No database role can both run the system and be unable to disable a trigger: the table owner can `DISABLE TRIGGER`,
drop it, or `TRUNCATE`. On Neon, other `neon_superuser` members may have the same reach; that has not been verified, so treat
them as privileged too. The first three layers stop every ordinary path; the
digest chain makes a privileged change visible.

## What the generator ships

- **Partitioning.** `audit_log` is range-partitioned on `created_at` (monthly). A partitioned table's primary key must include the
  partition key, so the Prisma model has `@@id([id, created_at])`. Prisma cannot declare partitioning; the SQL template converts
  the table (idempotent) and adds a default partition. `prisma db push` and `prisma migrate dev` leave a partitioned parent
  table alone (checked: no drift reported, nothing recreated). `audit_log_create_month_partition(timestamptz)` creates a
  monthly partition (`SECURITY DEFINER` with a pinned `search_path`, `EXECUTE` revoked from `PUBLIC` and granted to the application
  role by `audit_log_app_role.sql`, so the restricted role can create next month's partition without owning the table); create next month's ahead of time (`npm run audit-log:digest -- ensure-partitions`, run as the owner),
  because it cannot be created once the default partition holds rows for that month.
- **Test databases.** `prisma db push` does not run SQL, so `npm run db:apply-audit-log-sql` runs after it (in `setup` and every
  `test:e2e*` script). `resetTestDatabase()` empties `audit_log` and `audit_log_digest` with `TRUNCATE` as the owner, because the
  trigger rejects `DELETE` (`TRUNCATE` is not seen by row triggers).
- **Digest job and verification.** `npm run audit-log:digest -- close` closes every ended UTC day (with a one-hour margin so rows from
  transactions in flight at the boundary are included): a SHA-256 over the period header, the previous digest and each row in
  `created_at`, byte-wise `id` order, with metadata keys sorted. `-- verify` recomputes every period from the rows (or from
  archive files for archived periods) and compares with the table and the storage copy; it exits 1 on any mismatch. Schedule `close`
  and `verify` with your scheduler. Storage is the `AuditLogStorage` interface (`lib/audit-log-integrity/storage.ts`); the
  bundled `LocalDirectoryStorage` (`AUDIT_LOG_STORAGE_DIR`) is for tests and local runs.
- **Partition export.** `npm run audit-log:digest -- export-month YYYY-MM` writes the month as JSON Lines plus its SHA-256 to
  storage. Rows written after the last digest and before the next are protected by the first three layers only until the next run.

## What digest verification detects

`verify` (`npm run audit-log:digest -- verify`, or a scheduled task wrapping `verifyAuditLogDigests`) reads **every** row of
`audit_log_digest` on every run, recomputes each closed period from the live rows (from the archive file when the period's
rows were archived and the partition dropped) and compares the result with the table and with the storage copy. It does not
look only at the latest day. Observed on a local database, after the corresponding change was made by the table owner with the
row trigger disabled:

| Change | Reported by the next `verify` |
|---|---|
| A row of a closed period is edited | `digest_mismatch`, and `storage_mismatch` |
| A row is inserted into, or deleted from, a closed period | `row_count_mismatch`, `digest_mismatch`, and `storage_mismatch` |
| The same edit, plus the `audit_log_digest` rows rewritten and re-chained to match the edited rows | `storage_mismatch` for every period from the edit onward (the table and the chain are consistent, the storage copy is not) |
| The same, plus the storage copies rewritten (local-directory storage) | Nothing: `verify` passes |
| A digest row in the middle of the table is deleted | `chain_break` at the next period |
| The newest digest row is deleted, together with a change to that period's rows | Nothing from `verify`: it only visits periods present in the table. The next `close` recomputes the period, finds a different body at the existing storage key and refuses to overwrite it, so the `close` run fails |
| A row of the current day (not yet closed) is edited | Nothing: the content at close time is what the digest records |

What this means:

- A change to a closed period is caught on the next `verify`, however old the period, because every period is recomputed each
  time.
- The storage copy is the trust anchor. Rewriting the digest table and re-chaining it defeats the table but not a copy the
  attacker cannot rewrite. That holds only with write-once storage (S3 Object Lock in compliance mode, GCS Bucket Lock). With
  `LocalDirectoryStorage`, whoever can write the database can usually write the directory too, so this guarantee does not
  exist (fourth row of the table). Object Lock protects a copy only until its retention date; choose a retention period at
  least as long as the history that must stay verifiable.
- Changes before a period is closed are not detectable: closing is what fixes a period's content. The window is the current UTC
  day plus the close margin, until `close` has run.
- `verify` does not enumerate storage, so a digest that exists only in storage is not reported. Compare the key listing of the
  digests prefix with the table occasionally, and treat a failed `close` with `Refusing to overwrite` as an alarm.
- When all rows of a period are gone and an archive file exists for its month, `verify` recomputes the period from the file, so
  an export is treated as a retirement, not as a deletion. The archive file's own SHA-256 is checked on read.

## What a consumer sets up

1. Add `prisma/sql/audit_log_append_only.sql` to one of your own Prisma migrations (a hand-edited `migration.sql`; the
   generator ships no migrations). Clean up any existing `audit_log.metadata` that holds personal data first.
2. Create the application role with SQL `CREATE ROLE` (roles made in the Neon console or API are `neon_superuser` members),
   apply `audit_log_app_role.sql` for it, and switch the application's connection string to it. Migrations and the retention
   procedure keep using the owner role. The role-and-connection steps (password, connection strings, per-branch roles,
   verification) are listed under "Switching the application to the restricted role" below.
   That template covers `audit_log` and `audit_log_digest` only. Give the role its rights on every other table yourself
   (for example `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`, plus `USAGE` on sequences) and set
   `ALTER DEFAULT PRIVILEGES` as the owner so tables created by later migrations are covered too.
   Re-run `audit_log_append_only.sql` on an existing database to pick up the `SECURITY DEFINER` function.
3. Provide write-once storage (for example S3 Object Lock in compliance mode or GCS Bucket Lock) by implementing `AuditLogStorage`,
   and schedule the digest job against it.
4. Define the retention procedure: when a partition passes the online retention period, export it, copy the file to the write-once
   bucket, then as the owner `ALTER TABLE audit_log DETACH PARTITION audit_log_YYYY_MM; DROP TABLE audit_log_YYYY_MM;` and log the
   run. No row-level `DELETE` is involved.
5. Limit who holds owner-role and database console access and keep a record of its use.

## Switching the application to the restricted role

A consumer's own runbook is the place for its exact commands; a consumer generated from this repository that follows the
steps below ends with a working restricted role. The reference runbook of the app-template consumer is
`docs/knowledge/audit-log-operations.md` in that repository.

These steps change a deployed database. A person with access to it performs them; an automated agent does not, and no
password or connection string is ever passed on a command line or recorded in a repository.

1. **`CREATE ROLE ... LOGIN` sets no password.** Until one is set, a connection as the role fails with
   `password authentication failed`.
2. **Set the password with a plaintext `ALTER ROLE`, fed through standard input.** Neon does not accept a hashed password,
   which is what psql's `\password` sends, and a role created with SQL needs a high-entropy password (generate a long random
   one). Feed `ALTER ROLE app_runtime PASSWORD '...'` to `psql` on standard input, so the password appears neither in the
   process arguments nor in the psql history.
3. **Assemble the connection strings by hand.** The Neon console's Connect dialog lists only roles that Neon manages, so a
   role created with SQL is not offered. `DATABASE_URL` is the restricted role with the pooled host; `DIRECT_URL` is the
   owner with the unpooled host (read only by the Prisma CLI for `migrate deploy`).
4. **Create the role on every Neon branch.** Neon roles belong to a branch: staging and production each need their own
   `app_runtime`, with its own password.
5. **Verify as the restricted role, with its own credentials.** When switching `PGUSER` in a shell, switch `PGPASSWORD` as
   well; a leftover owner password makes a wrong-password failure indistinguishable from a missing grant. `SELECT
   current_user` returns `app_runtime`, and `TRUNCATE audit_log` fails with `permission denied`.
6. **`scripts/vercel-setup.sh` injects the owner's pooled URL as `DATABASE_URL`.** Re-running it (or
   `scripts/vercel-env.sh inject`) overwrites a `DATABASE_URL` that was set to the restricted role. After any re-run, set
   `DATABASE_URL` for each Vercel environment back to the restricted role's connection string by hand. The script
   prints a reminder when it injects.

The scheduled task `audit_log_ensure_partitions` writes a completion record to `scheduled_task_run`. If that table is
missing from the database, the run fails with `The table public.scheduled_task_run does not exist in the current
database`; see "Consumer migration" in `docs/knowledge/scheduled-task-operations.md`.

## If personal data ends up in `metadata` anyway

Removing it needs the owner to disable the trigger in a recorded maintenance step. That shows up as a digest mismatch for the
period; resolve it by recording a new digest with a written reason while the original storage copy stays.
