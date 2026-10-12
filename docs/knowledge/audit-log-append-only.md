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

## What a consumer sets up

1. Add `prisma/sql/audit_log_append_only.sql` to one of your own Prisma migrations (a hand-edited `migration.sql`; the
   generator ships no migrations). Clean up any existing `audit_log.metadata` that holds personal data first.
2. Create the application role with SQL `CREATE ROLE` (roles made in the Neon console or API are `neon_superuser` members),
   apply `audit_log_app_role.sql` for it, and switch the application's connection string to it. Migrations and the retention
   procedure keep using the owner role.
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

## If personal data ends up in `metadata` anyway

Removing it needs the owner to disable the trigger in a recorded maintenance step. That shows up as a digest mismatch for the
period; resolve it by recording a new digest with a written reason while the original storage copy stays.
