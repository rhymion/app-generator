-- Phase 1.2: add user.tenant_id with a safe 4-step backfill.
--
-- Test and dev environments use `prisma db push`, which collapses these
-- steps into a single rewrite. This script is for production-style
-- deployments where existing rows must survive the column addition. It
-- is also the shape the auto-migrate script in ticket 1.5 will emit.
--
-- Assumes the 1.1 schema change has already been applied and the
-- "default" tenant row exists (id = 'default'). If you haven't, run
-- those steps first or set @backfill_tenant_id below to a tenant id
-- that does exist.

\set backfill_tenant_id '''default'''

BEGIN;

-- 1) Add the column nullable so the rewrite touches every existing row
--    without violating NOT NULL.
ALTER TABLE "user"
  ADD COLUMN "tenant_id" TEXT;

-- 2) Backfill every existing row to the bootstrap tenant. Operators who
--    pre-seeded multiple tenants and want a different mapping should
--    replace this with their own UPDATE before running.
UPDATE "user"
   SET "tenant_id" = :backfill_tenant_id
 WHERE "tenant_id" IS NULL;

-- 3) Lock in the invariant. After this point every user has a tenant.
ALTER TABLE "user"
  ALTER COLUMN "tenant_id" SET NOT NULL;

-- 4) Attach the FK now that the column is fully populated. onDelete is
--    RESTRICT — accidental tenant deletion must not cascade to users.
ALTER TABLE "user"
  ADD CONSTRAINT "user_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supporting index: every tenant-scoped query starts with
-- WHERE tenant_id = $1, so this index is the cheapest reject.
CREATE INDEX IF NOT EXISTS "user_tenant_id_idx"
  ON "user"("tenant_id");

-- Also set the column default to 'default' so writes that pre-date the
-- generator updates in Phase 3 keep working. Once every caller threads
-- tenant_id through explicitly, this default can be dropped.
ALTER TABLE "user"
  ALTER COLUMN "tenant_id" SET DEFAULT 'default';

COMMIT;
