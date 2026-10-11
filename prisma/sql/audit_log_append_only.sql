-- audit_log append-only template (idempotent; safe to run repeatedly).
--
-- Applied automatically after `prisma db push` for test databases
-- (npm run db:apply-audit-log-sql). A consumer adds the same statements to
-- one of its own Prisma migrations (a hand-edited migration.sql) at
-- deployment time; the generator ships no migrations.
-- See docs/knowledge/audit-log-append-only.md.
--
-- Run it as the table owner. It does three things:
--   1. Converts audit_log to a table range-partitioned on created_at (the
--      primary key is (id, created_at), declared in prisma/schema.prisma).
--   2. Installs a row trigger on audit_log and audit_log_digest that rejects
--      every UPDATE and DELETE.
--   3. Defines audit_log_create_month_partition(), the maintenance function
--      the retention procedure and the digest job use to add monthly
--      partitions.
-- TRUNCATE is not blocked by a row trigger; it is closed off for the
-- application role by privilege (see audit_log_app_role.sql) and covered for
-- the owner by the digest chain.

-- 1. Partition audit_log (no-op when it is already partitioned).
DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('audit_log')) <> 'p' THEN
    ALTER TABLE audit_log RENAME TO audit_log_unpartitioned;
    ALTER TABLE audit_log_unpartitioned RENAME CONSTRAINT audit_log_pkey TO audit_log_unpartitioned_pkey;
    ALTER TABLE audit_log_unpartitioned DROP CONSTRAINT IF EXISTS audit_log_actor_user_id_fkey;
    ALTER INDEX IF EXISTS audit_log_actor_user_id_idx RENAME TO audit_log_unpartitioned_actor_user_id_idx;
    ALTER INDEX IF EXISTS audit_log_target_table_target_id_idx RENAME TO audit_log_unpartitioned_target_idx;
    ALTER INDEX IF EXISTS audit_log_created_at_idx RENAME TO audit_log_unpartitioned_created_at_idx;

    CREATE TABLE audit_log (LIKE audit_log_unpartitioned INCLUDING DEFAULTS) PARTITION BY RANGE (created_at);
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at);
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
    CREATE INDEX audit_log_actor_user_id_idx ON audit_log (actor_user_id);
    CREATE INDEX audit_log_target_table_target_id_idx ON audit_log (target_table, target_id);
    CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);

    -- Catch-all so an insert never fails for want of a monthly partition.
    CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

    INSERT INTO audit_log SELECT * FROM audit_log_unpartitioned;
    DROP TABLE audit_log_unpartitioned;
  END IF;
END
$$;

-- 2. Reject UPDATE and DELETE on audit_log and audit_log_digest. A row
-- trigger created on the partitioned parent is created on every partition.
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

DROP TRIGGER IF EXISTS audit_log_digest_append_only ON audit_log_digest;
CREATE TRIGGER audit_log_digest_append_only
  BEFORE UPDATE OR DELETE ON audit_log_digest
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

-- 3. Monthly partition maintenance. Creates the partition covering the month
-- that contains `month_start` (UTC) if it does not exist yet. It fails when
-- audit_log_default already holds rows in that month; create partitions
-- ahead of time (the digest job calls this for the current and next month).
CREATE OR REPLACE FUNCTION audit_log_create_month_partition(month_start timestamptz)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  first_day timestamptz := date_trunc('month', month_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_day timestamptz := first_day + interval '1 month';
  part_name text := 'audit_log_' || to_char(first_day AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
  IF to_regclass(part_name) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
                   part_name, first_day, next_day);
  END IF;
  RETURN part_name;
END
$$;

SELECT audit_log_create_month_partition(now());
SELECT audit_log_create_month_partition(now() + interval '1 month');
